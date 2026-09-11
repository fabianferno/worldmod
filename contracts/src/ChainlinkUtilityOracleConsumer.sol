// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChainlinkUtilityOracleConsumer
 * @notice Receives a Chainlink CRE Confidential Workflow's utility report and
 *         settles a bounty's utility pool — the TEE-attested replacement for
 *         the trusted `UtilityOracle` operator product-spec §8.3 flagged.
 *
 * The workflow (see `cre/utility-oracle/`) pulls each contributor's raw
 * leave-one-contributor-out delta, applies a **secret weighting policy** fetched
 * inside an AWS Nitro enclave, and normalises the result into basis-point shares
 * there. The intermediate deltas and the policy never leave the enclave; only
 * the final `(bountyId, contributors, sharesBps)` crosses back out, DON-signed,
 * and is delivered here through a known forwarder. This contract then relays it
 * into `BountyEscrow.settleUtility` — so the escrow no longer trusts a single
 * operator EOA to post utility shares.
 *
 * Set as the escrow's oracle via `BountyEscrow.setOracle(consumer)` — no
 * redeploy of `BountyEscrow` itself. Accepts two forwarders (production
 * KeystoneForwarder + the tenant's mock forwarder), mirroring
 * `ChainlinkValidatorConsumer`.
 */
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IBountyEscrow {
    function settleUtility(bytes32 bountyId, address[] calldata contributors, uint32[] calldata sharesBps) external;
}

contract ChainlinkUtilityOracleConsumer is IReceiver {
    IBountyEscrow public immutable escrow;
    address public owner;

    /// @dev The primary Chainlink forwarder (production KeystoneForwarder).
    address public forwarder;

    /// @dev A second accepted forwarder (e.g. the tenant's mock forwarder).
    ///      Zero means "no alternate"; a zero address never authorizes a call.
    address public altForwarder;

    event ForwarderSet(address indexed forwarder);
    event AltForwarderSet(address indexed altForwarder);
    event UtilityReportProcessed(bytes32 indexed bountyId, uint256 recipients);

    error NotOwner();
    error NotForwarder();

    constructor(IBountyEscrow bountyEscrow, address forwarderAddress, address altForwarderAddress) {
        escrow = bountyEscrow;
        owner = msg.sender;
        forwarder = forwarderAddress;
        altForwarder = altForwarderAddress;
        emit ForwarderSet(forwarderAddress);
        emit AltForwarderSet(altForwarderAddress);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Repoint the primary forwarder, e.g. after a Chainlink DON rotation.
    function setForwarder(address forwarderAddress) external onlyOwner {
        forwarder = forwarderAddress;
        emit ForwarderSet(forwarderAddress);
    }

    /// @notice Repoint the alternate (e.g. mock) forwarder. Set to the zero
    ///         address to disable the alternate entirely.
    function setAltForwarder(address altForwarderAddress) external onlyOwner {
        altForwarder = altForwarderAddress;
        emit AltForwarderSet(altForwarderAddress);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external override {
        // A zero altForwarder must never authorize a caller, so compare against
        // it only when it is set.
        if (msg.sender != forwarder && !(altForwarder != address(0) && msg.sender == altForwarder)) {
            revert NotForwarder();
        }

        (bytes32 bountyId, address[] memory contributors, uint32[] memory sharesBps) =
            abi.decode(report, (bytes32, address[], uint32[]));

        escrow.settleUtility(bountyId, contributors, sharesBps);
        emit UtilityReportProcessed(bountyId, contributors.length);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
