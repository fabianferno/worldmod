// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EpisodeRegistry} from "./EpisodeRegistry.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title BountyEscrow
 * @notice Demand-first bounties: a buyer escrows USDC, contributors generate the data.
 *
 * Two structural decisions carry the weight.
 *
 * **The escrow can never promise more than it holds.** A bounty's allocations
 * are checked against its budget at creation — product-spec §7's own example
 * bounty allocates 110 USDC against a 100 USDC budget once §13's validator and
 * treasury fees are counted, and a contract that accepted it would run out of
 * money partway through paying contributors who had already done the work.
 *
 * **Contributors pull; the escrow never pushes.** Acceptance credits a balance
 * and the contributor withdraws it. Paying inline would let one contributor
 * with a reverting fallback block acceptance for everyone, and would put an
 * external call in the middle of accounting.
 */
contract BountyEscrow {
    struct Bounty {
        address buyer;
        uint96 perEpisode;
        uint96 utilityPool;
        uint96 validatorFee;
        uint96 treasuryFee;
        uint96 budget;
        uint96 spent;
        uint32 maxEpisodes;
        uint32 accepted;
        uint64 deadline;
        bool closed;
    }

    IERC20 public immutable token;
    EpisodeRegistry public immutable episodes;
    address public owner;

    mapping(bytes32 => Bounty) private _bounties;
    /// @dev Credited on acceptance, withdrawn by the contributor.
    mapping(address => uint256) public balanceOf;
    /// @dev One payment per episode, whatever else happens.
    mapping(uint256 => bool) public episodePaid;

    event BountyCreated(bytes32 indexed bountyId, address indexed buyer, uint96 budget);
    event EpisodeAccepted(bytes32 indexed bountyId, uint256 indexed episodeId, address contributor, uint96 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event BountyRefunded(bytes32 indexed bountyId, address indexed buyer, uint256 amount);

    error NotOwner();
    error NotBuyer();
    error BountyExists();
    error UnknownBounty();
    error BountyClosed();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error BudgetMismatch();
    error EmptyBounty();
    error TransferFailed();
    error EpisodeAlreadyPaid();
    error EpisodeNotValidated();
    error WrongBounty();
    error QuotaReached();
    error NothingToWithdraw();

    constructor(IERC20 usdc, EpisodeRegistry episodeRegistry) {
        token = usdc;
        episodes = episodeRegistry;
        owner = msg.sender;
    }

    function getBounty(bytes32 bountyId) external view returns (Bounty memory) {
        if (_bounties[bountyId].buyer == address(0)) revert UnknownBounty();
        return _bounties[bountyId];
    }

    /// @notice Funds committed but not yet owed to anyone.
    function unspent(bytes32 bountyId) public view returns (uint256) {
        Bounty storage bounty = _bounties[bountyId];
        return bounty.budget - bounty.spent;
    }

    /**
     * @notice Create a bounty and escrow its entire budget up front.
     * @dev The buyer must have approved this contract for `budget` first.
     */
    function createBounty(
        bytes32 bountyId,
        uint96 budget,
        uint96 perEpisode,
        uint32 maxEpisodes,
        uint96 utilityPool,
        uint96 validatorFee,
        uint96 treasuryFee,
        uint64 deadline
    ) external {
        if (_bounties[bountyId].buyer != address(0)) revert BountyExists();
        if (budget == 0 || maxEpisodes == 0) revert EmptyBounty();
        if (deadline <= block.timestamp) revert DeadlinePassed();

        // Everything the bounty can ever owe, checked before a cent is taken.
        uint256 committed =
            uint256(perEpisode) * maxEpisodes + uint256(utilityPool) + validatorFee + treasuryFee;
        if (committed != budget) revert BudgetMismatch();

        _bounties[bountyId] = Bounty({
            buyer: msg.sender,
            perEpisode: perEpisode,
            utilityPool: utilityPool,
            validatorFee: validatorFee,
            treasuryFee: treasuryFee,
            budget: budget,
            spent: 0,
            maxEpisodes: maxEpisodes,
            accepted: 0,
            deadline: deadline,
            closed: false
        });

        // Funds move last, after all state is consistent.
        if (!token.transferFrom(msg.sender, address(this), budget)) revert TransferFailed();
        emit BountyCreated(bountyId, msg.sender, budget);
    }

    /**
     * @notice Accept a validated episode and credit its contributor.
     * @dev Callable by the bounty's buyer. The episode must already carry a
     *      validation result: paying for work nobody has checked would make the
     *      validator ornamental.
     */
    function acceptEpisode(bytes32 bountyId, uint256 episodeId) external {
        Bounty storage bounty = _bounties[bountyId];
        if (bounty.buyer == address(0)) revert UnknownBounty();
        if (msg.sender != bounty.buyer) revert NotBuyer();
        if (bounty.closed) revert BountyClosed();
        if (block.timestamp > bounty.deadline) revert DeadlinePassed();
        if (bounty.accepted >= bounty.maxEpisodes) revert QuotaReached();
        if (episodePaid[episodeId]) revert EpisodeAlreadyPaid();

        EpisodeRegistry.Episode memory episode = episodes.getEpisode(episodeId);
        if (episode.bountyId != bountyId) revert WrongBounty();
        if (!episodes.getValidation(episodeId).recorded) revert EpisodeNotValidated();

        episodePaid[episodeId] = true;
        bounty.accepted += 1;
        bounty.spent += bounty.perEpisode;
        balanceOf[episode.contributor] += bounty.perEpisode;

        emit EpisodeAccepted(bountyId, episodeId, episode.contributor, bounty.perEpisode);
    }

    /// @notice Withdraw everything credited to you.
    function withdraw() external {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // Zeroed before the transfer: the classic reentrancy guard, and cheaper
        // than a mutex.
        balanceOf[msg.sender] = 0;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Return whatever the bounty did not spend, after its deadline.
     * @dev Only unspent funds: anything already credited to a contributor
     *      belongs to them and is not the buyer's to reclaim.
     */
    function refundExpired(bytes32 bountyId) external {
        Bounty storage bounty = _bounties[bountyId];
        if (bounty.buyer == address(0)) revert UnknownBounty();
        if (msg.sender != bounty.buyer) revert NotBuyer();
        if (block.timestamp <= bounty.deadline) revert DeadlineNotPassed();
        if (bounty.closed) revert BountyClosed();

        uint256 remaining = unspent(bountyId);
        bounty.closed = true;
        bounty.spent = bounty.budget;

        if (remaining > 0) {
            if (!token.transfer(bounty.buyer, remaining)) revert TransferFailed();
        }
        emit BountyRefunded(bountyId, bounty.buyer, remaining);
    }
}
