// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EpisodeRegistry} from "./EpisodeRegistry.sol";

/**
 * @title ChainlinkValidatorConsumer
 * @notice Receives a Chainlink CRE Confidential Workflow's report and records it
 *         as an episode validation.
 *
 * The workflow (see `cre/episode-validator/`) fetches a bounty's acceptance
 * threshold as a secret inside a TEE, compares it against the episode's
 * already-computed plausibility/framing score, and emits only the verdict.
 * The DON reaches consensus on that verdict and delivers it here through a
 * known forwarder — this contract never sees the threshold, and the workflow
 * never holds a chain key. It only relays what the DON co-signed into
 * `EpisodeRegistry.recordValidation`, following the `IReceiver` shape
 * Chainlink's CRE report-consumer contracts use.
 *
 * Two forwarders are accepted, mirroring the reference `perjury` VerdictSink:
 * the production `KeystoneForwarder` and the tenant's mock forwarder (both from
 * `cre workflow supported-chains`). This lets a report land whether it was
 * delivered by the live DON or a mock/test path, without repointing between
 * runs. Either slot can also be rotated by the owner after a DON key change.
 *
 * Registered as an additional validator via `EpisodeRegistry.setValidator` —
 * no redeploy of `EpisodeRegistry` itself.
 */
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract ChainlinkValidatorConsumer is IReceiver {
    EpisodeRegistry public immutable episodes;
    address public owner;

    /// @dev The primary Chainlink forwarder (production KeystoneForwarder).
    address public forwarder;

    /// @dev A second accepted forwarder (e.g. the tenant's mock forwarder).
    ///      Zero means "no alternate"; a zero address never authorizes a call.
    address public altForwarder;

    event ForwarderSet(address indexed forwarder);
    event AltForwarderSet(address indexed altForwarder);
    event ReportProcessed(uint256 indexed episodeId, uint16 score, EpisodeRegistry.TrustLevel trustLevel);

    error NotOwner();
    error NotForwarder();

    constructor(EpisodeRegistry episodeRegistry, address forwarderAddress, address altForwarderAddress) {
        episodes = episodeRegistry;
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

        (uint256 episodeId, uint16 score, uint8 trustLevel) = abi.decode(report, (uint256, uint16, uint8));
        EpisodeRegistry.TrustLevel level = EpisodeRegistry.TrustLevel(trustLevel);

        episodes.recordValidation(episodeId, score, level);
        emit ReportProcessed(episodeId, score, level);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
