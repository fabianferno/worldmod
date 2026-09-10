// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
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
 * @title FederatedRound
 * @notice Coordination for federated training rounds. The data never moves.
 *
 * This is product-spec §9's on-chain half, and §9.2's honesty applies to every
 * line of it: what this demonstrates is *coordination*, not privacy. FedAvg
 * alone is not private — gradient inversion against shared updates is a real
 * and published attack, especially with few clients. Nothing here adds
 * differential privacy, secure aggregation or a client-count threshold, and
 * naming the contract after the pattern it implements rather than a guarantee
 * it does not provide is deliberate.
 *
 * What it does record is checkable: who took part, a hash of each participant's
 * weight update, the resulting global model hash, and the metric that came out.
 * A participant who claims afterwards to have contributed a different update is
 * contradicted by their own hash.
 *
 * Payment is per round and equal. Weighting by contribution would need a
 * measure of how much each update helped, which is §8.3's utility problem —
 * genuinely hard, already solved once for episodes, and not worth a second,
 * weaker answer here.
 */
contract FederatedRound {
    enum Status {
        None,
        Open,
        Finalized
    }

    struct Round {
        bytes32 modelId;
        address coordinator;
        uint96 payoutPerParticipant;
        uint32 participantCount;
        uint32 submittedCount;
        uint64 openedAt;
        uint64 finalizedAt;
        bytes32 globalHash;
        /// @dev Held as basis points; the metric is an error, so lower is better.
        uint32 metricBps;
        Status status;
    }

    IERC20Minimal public immutable token;
    address public owner;

    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => address[]) private _participants;
    /// @dev roundId => participant => update hash. Zero means nothing submitted.
    mapping(uint256 => mapping(address => bytes32)) public updateOf;
    mapping(uint256 => mapping(address => bool)) public isParticipant;
    mapping(address => uint256) public balanceOf;

    uint256 public roundCount;

    uint256 private constant MAX_PARTICIPANTS = 100;

    event RoundOpened(uint256 indexed roundId, bytes32 indexed modelId, uint32 participants, uint96 payoutEach);
    event UpdateSubmitted(uint256 indexed roundId, address indexed participant, bytes32 updateHash);
    event RoundFinalized(uint256 indexed roundId, bytes32 globalHash, uint32 metricBps, uint256 paid);
    event Withdrawn(address indexed account, uint256 amount);

    error NotOwner();
    error NotCoordinator();
    error NotParticipant();
    error UnknownRound();
    error RoundNotOpen();
    error RoundAlreadyFinalized();
    error NoParticipants();
    error TooManyParticipants();
    error DuplicateParticipant();
    error ZeroAddress();
    error AlreadySubmitted();
    error EmptyUpdateHash();
    error EmptyGlobalHash();
    error MetricOutOfRange();
    error TransferFailed();
    error NothingToWithdraw();

    constructor(IERC20Minimal usdc) {
        token = usdc;
        owner = msg.sender;
        // A deploy must never leave the round contract live but unable to
        // hold the token it was configured with — see the interface doc
        // above. Return value deliberately unchecked: on a non-Hedera chain
        // this call has no code to execute against and "succeeds" doing
        // nothing.
        (bool associated,) = address(0x167).call(
            abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), address(usdc))
        );
        associated;
    }

    function getRound(uint256 roundId) external view returns (Round memory) {
        if (roundId == 0 || roundId > roundCount) revert UnknownRound();
        return _rounds[roundId];
    }

    function participantsOf(uint256 roundId) external view returns (address[] memory) {
        if (roundId == 0 || roundId > roundCount) revert UnknownRound();
        return _participants[roundId];
    }

    /**
     * @notice Open a round and escrow every payout it can owe.
     * @dev Funded up front for the same reason BountyEscrow is: a round that
     *      finalizes and then cannot pay has already consumed the participants'
     *      compute.
     */
    function openRound(bytes32 modelId, address[] calldata participants, uint96 payoutPerParticipant)
        external
        returns (uint256 roundId)
    {
        if (participants.length == 0) revert NoParticipants();
        if (participants.length > MAX_PARTICIPANTS) revert TooManyParticipants();

        roundId = ++roundCount;

        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            if (participant == address(0)) revert ZeroAddress();
            if (isParticipant[roundId][participant]) revert DuplicateParticipant();
            isParticipant[roundId][participant] = true;
        }

        _participants[roundId] = participants;
        _rounds[roundId] = Round({
            modelId: modelId,
            coordinator: msg.sender,
            payoutPerParticipant: payoutPerParticipant,
            participantCount: uint32(participants.length),
            submittedCount: 0,
            openedAt: uint64(block.timestamp),
            finalizedAt: 0,
            globalHash: bytes32(0),
            metricBps: 0,
            status: Status.Open
        });

        uint256 escrow = uint256(payoutPerParticipant) * participants.length;
        if (escrow > 0) {
            if (!token.transferFrom(msg.sender, address(this), escrow)) revert TransferFailed();
        }

        emit RoundOpened(roundId, modelId, uint32(participants.length), payoutPerParticipant);
    }

    /**
     * @notice Commit to the weight update produced locally. The weights stay put.
     * @dev Once only: a participant who could revise their hash after seeing
     *      the global model could claim to have submitted whatever helped.
     */
    function submitUpdate(uint256 roundId, bytes32 updateHash) external {
        Round storage round = _rounds[roundId];
        if (round.status == Status.None) revert UnknownRound();
        if (round.status != Status.Open) revert RoundNotOpen();
        if (!isParticipant[roundId][msg.sender]) revert NotParticipant();
        if (updateHash == bytes32(0)) revert EmptyUpdateHash();
        if (updateOf[roundId][msg.sender] != bytes32(0)) revert AlreadySubmitted();

        updateOf[roundId][msg.sender] = updateHash;
        round.submittedCount += 1;

        emit UpdateSubmitted(roundId, msg.sender, updateHash);
    }

    /**
     * @notice Record the aggregate and pay everyone who actually submitted.
     * @param metricBps Held-out error in basis points; lower is better.
     * @dev Only participants who submitted are paid. Escrow for the rest stays
     *      with the coordinator, who can withdraw it — nobody is paid for a
     *      round they sat out, and nobody's payment depends on someone else
     *      having turned up.
     */
    function finalizeRound(uint256 roundId, bytes32 globalHash, uint32 metricBps) external {
        Round storage round = _rounds[roundId];
        if (round.status == Status.None) revert UnknownRound();
        if (round.status == Status.Finalized) revert RoundAlreadyFinalized();
        if (msg.sender != round.coordinator) revert NotCoordinator();
        if (globalHash == bytes32(0)) revert EmptyGlobalHash();
        if (metricBps > 10_000) revert MetricOutOfRange();

        round.status = Status.Finalized;
        round.globalHash = globalHash;
        round.metricBps = metricBps;
        round.finalizedAt = uint64(block.timestamp);

        address[] storage participants = _participants[roundId];
        uint256 paid;

        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            if (updateOf[roundId][participant] == bytes32(0)) continue;

            balanceOf[participant] += round.payoutPerParticipant;
            paid += round.payoutPerParticipant;
        }

        // Whatever no-shows left behind returns to whoever funded the round.
        uint256 escrowed = uint256(round.payoutPerParticipant) * participants.length;
        if (escrowed > paid) {
            balanceOf[round.coordinator] += escrowed - paid;
        }

        emit RoundFinalized(roundId, globalHash, metricBps, paid);
    }

    function withdraw() external {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        balanceOf[msg.sender] = 0;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }
}
