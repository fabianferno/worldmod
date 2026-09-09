// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EpisodeRegistry} from "./EpisodeRegistry.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Hedera Token Service precompile, fixed at 0x167 on every Hedera
/// network. On any other chain this address has no code, so the low-level
/// call below succeeds trivially with empty returndata and self-association
/// is silently skipped — the same bytecode deploys unmodified to Sepolia or
/// Hedera; real association only happens where the precompile actually
/// exists. Proven live against Hedera testnet before wiring this in — see
/// hedera/spike-hts-association-part3.mjs.
interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
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
 *
 * **Every allocation has a way out.** product-spec §13 splits a bounty four
 * ways — contributors, a utility pool, validators, treasury — and an earlier
 * version of this contract escrowed all four while only being able to pay the
 * first. Forty percent of every bounty could reach nobody but the buyer, which
 * made §7's claim that the utility pool "moves the network off paying-per-
 * gigabyte" unbackable in code. Validator and treasury shares now accrue per
 * accepted episode, and `settleUtility` distributes the pool.
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
        /// @dev The utility pool pays once and only once.
        bool utilitySettled;
    }

    /// @dev Shares are basis points and must total exactly this.
    uint256 private constant BPS = 10_000;

    /// @dev A settlement must fit in one transaction; the oracle batches.
    uint256 private constant MAX_RECIPIENTS = 200;

    IERC20 public immutable token;
    EpisodeRegistry public immutable episodes;
    address public owner;

    /**
     * @dev Posts utility scores. Deliberately not the buyer: a buyer who chose
     *      which contributors were "useful" would be grading the work they are
     *      paying for. product-spec §8.3 is explicit that this role is
     *      centralized in the MVP and that decentralizing it is hard.
     */
    address public oracle;
    address public treasury;

    mapping(bytes32 => Bounty) private _bounties;
    /// @dev Credited on acceptance, withdrawn by the contributor.
    mapping(address => uint256) public balanceOf;
    /// @dev One payment per episode, whatever else happens.
    mapping(uint256 => bool) public episodePaid;

    event BountyCreated(bytes32 indexed bountyId, address indexed buyer, uint96 budget);
    event EpisodeAccepted(bytes32 indexed bountyId, uint256 indexed episodeId, address contributor, uint96 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event BountyRefunded(bytes32 indexed bountyId, address indexed buyer, uint256 amount);
    event UtilityPaid(bytes32 indexed bountyId, address indexed contributor, uint32 shareBps, uint256 amount);
    event UtilitySettled(bytes32 indexed bountyId, uint256 distributed);
    event FeeAccrued(
        bytes32 indexed bountyId, address indexed validator, uint256 validatorAmount, uint256 treasuryAmount
    );
    event OracleSet(address indexed oracle);
    event TreasurySet(address indexed treasury);

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
    error NotOracle();
    error UtilityAlreadySettled();
    error LengthMismatch();
    error NoRecipients();
    error TooManyRecipients();
    error SharesMustTotalBps();
    error ZeroAddress();

    constructor(IERC20 usdc, EpisodeRegistry episodeRegistry) {
        token = usdc;
        episodes = episodeRegistry;
        owner = msg.sender;
        // Usable from the first block; the owner can move both afterwards.
        oracle = msg.sender;
        treasury = msg.sender;
        // A deploy must never leave the escrow live but unable to hold the
        // token it was configured with — see the interface doc above. The
        // return value is deliberately unchecked: on a non-Hedera chain this
        // call has no code to execute against and "succeeds" doing nothing.
        (bool associated,) = address(0x167).call(
            abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), address(usdc))
        );
        associated;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        oracle = newOracle;
        emit OracleSet(newOracle);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
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
        uint256 committed = uint256(perEpisode) * maxEpisodes + uint256(utilityPool) + validatorFee + treasuryFee;
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
            closed: false,
            utilitySettled: false
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
        balanceOf[episode.contributor] += bounty.perEpisode;

        // §13 allocates a validator and treasury share of every bounty. Both
        // accrue per accepted episode rather than as a lump sum: the validator
        // credited is the one that actually recorded this episode's result, so
        // the fee follows the work. A bounty that never fills leaves the rest
        // unspent, and the buyer reclaims it at the deadline.
        uint256 validatorCut = uint256(bounty.validatorFee) / bounty.maxEpisodes;
        uint256 treasuryCut = uint256(bounty.treasuryFee) / bounty.maxEpisodes;

        address validator = episodes.getValidation(episodeId).validator;
        if (validatorCut > 0 && validator != address(0)) {
            balanceOf[validator] += validatorCut;
        } else {
            validatorCut = 0;
        }
        if (treasuryCut > 0 && treasury != address(0)) {
            balanceOf[treasury] += treasuryCut;
        } else {
            treasuryCut = 0;
        }

        // Safe: each cut is a fraction of a uint96 fee, and createBounty proved
        // perEpisode * maxEpisodes + every fee equals budget, itself uint96.
        // forge-lint: disable-next-line(unsafe-typecast)
        bounty.spent += uint96(uint256(bounty.perEpisode) + validatorCut + treasuryCut);

        emit EpisodeAccepted(bountyId, episodeId, episode.contributor, bounty.perEpisode);
        if (validatorCut > 0 || treasuryCut > 0) {
            emit FeeAccrued(bountyId, validator, validatorCut, treasuryCut);
        }
    }

    /**
     * @notice Distribute the utility pool across contributors by measured share.
     *
     * This is product-spec §8.3's settlement: the trainer computes a
     * leave-one-contributor-out delta per contributor, normalises those into
     * shares, and the oracle posts them here. It is the mechanism §7 calls the
     * move away from paying per gigabyte, and without it the pool is money the
     * escrow can only ever hand back.
     *
     * Shares are basis points and must total exactly 10000, so the split is
     * auditable from the calldata alone rather than depending on this
     * contract's arithmetic. Integer division leaves at most a few wei
     * undistributed; that dust stays unspent and refunds to the buyer, which is
     * the one direction that cannot quietly overpay.
     */
    function settleUtility(bytes32 bountyId, address[] calldata contributors, uint32[] calldata sharesBps) external {
        if (msg.sender != oracle) revert NotOracle();

        Bounty storage bounty = _bounties[bountyId];
        if (bounty.buyer == address(0)) revert UnknownBounty();
        if (bounty.closed) revert BountyClosed();
        if (bounty.utilitySettled) revert UtilityAlreadySettled();
        if (contributors.length == 0) revert NoRecipients();
        if (contributors.length != sharesBps.length) revert LengthMismatch();
        if (contributors.length > MAX_RECIPIENTS) revert TooManyRecipients();

        uint256 totalBps;
        for (uint256 i = 0; i < sharesBps.length; i++) {
            totalBps += sharesBps[i];
        }
        if (totalBps != BPS) revert SharesMustTotalBps();

        // Set before any crediting: settlement happens once.
        bounty.utilitySettled = true;

        uint256 pool = bounty.utilityPool;
        uint256 distributed;

        for (uint256 i = 0; i < contributors.length; i++) {
            address contributor = contributors[i];
            if (contributor == address(0)) revert ZeroAddress();

            uint256 amount = (pool * sharesBps[i]) / BPS;
            if (amount == 0) continue;

            balanceOf[contributor] += amount;
            distributed += amount;
            emit UtilityPaid(bountyId, contributor, sharesBps[i], amount);
        }

        // Safe: shares total exactly BPS, so distributed <= pool = utilityPool,
        // which is uint96.
        // forge-lint: disable-next-line(unsafe-typecast)
        bounty.spent += uint96(distributed);
        emit UtilitySettled(bountyId, distributed);
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
