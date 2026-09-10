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

    /// @dev The Chainlink forwarder is the only address allowed to deliver a report.
    address public forwarder;

    event ForwarderSet(address indexed forwarder);
    event ReportProcessed(uint256 indexed episodeId, uint16 score, EpisodeRegistry.TrustLevel trustLevel);

    error NotOwner();
    error NotForwarder();

    constructor(EpisodeRegistry episodeRegistry, address forwarderAddress) {
        episodes = episodeRegistry;
        owner = msg.sender;
        forwarder = forwarderAddress;
        emit ForwarderSet(forwarderAddress);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Repoint the trusted forwarder, e.g. after a Chainlink DON rotation.
    function setForwarder(address forwarderAddress) external onlyOwner {
        forwarder = forwarderAddress;
        emit ForwarderSet(forwarderAddress);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder();

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
