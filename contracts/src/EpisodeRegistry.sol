// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AssetRegistry} from "./AssetRegistry.sol";
import {Relayable} from "./Relayable.sol";

/**
 * @title EpisodeRegistry
 * @notice On-chain commitments to physical episodes, and their validation results.
 *
 * Only the commitment lives here: an episode is tens of megabytes and the
 * chain's job is to make that blob accountable, not to hold it. What is stored
 * is the manifest hash, who committed it, when, and what the validator found.
 *
 * The honest limit, from product-spec §6.2, applies to everything below: this
 * proves that a specific key committed to a specific byte sequence at a
 * specific block. It proves nothing about whether those bytes came from a real
 * camera pointed at a real scene. The validation score is a plausibility
 * measure, and the trust level says so.
 */
contract EpisodeRegistry is Relayable {
    enum TrustLevel {
        SelfReported,
        Heuristic,
        Attested,
        Hardware
    }

    struct Episode {
        uint256 assetId;
        address contributor;
        bytes32 bountyId;
        bytes32 manifestHash;
        string storageURI;
        uint64 submittedAt;
    }

    struct Validation {
        /// @dev Plausibility in basis points, 0–10000. Integers, because money depends on it.
        uint16 score;
        TrustLevel trustLevel;
        address validator;
        uint64 validatedAt;
        bool recorded;
    }

    AssetRegistry public immutable assets;
    address public owner;

    /// @dev Validators are permissioned. product-spec §8.3 is explicit that this
    ///      is centralized in the MVP; decentralizing it is genuinely hard.
    mapping(address => bool) public isValidator;

    mapping(uint256 => Episode) private _episodes;
    mapping(uint256 => Validation) private _validations;
    /// @dev Guards against the same manifest being committed twice.
    mapping(bytes32 => uint256) public episodeByManifest;

    uint256 public episodeCount;

    bytes32 private constant _SUBMIT_TYPEHASH = keccak256(
        "SubmitEpisode(uint256 assetId,bytes32 bountyId,bytes32 manifestHash,string storageURI,uint256 nonce)"
    );

    event EpisodeSubmitted(
        uint256 indexed episodeId, uint256 indexed assetId, address indexed contributor, bytes32 manifestHash
    );
    event ValidationRecorded(uint256 indexed episodeId, uint16 score, TrustLevel trustLevel, address validator);
    event ValidatorSet(address indexed validator, bool allowed);

    error NotOwner();
    error NotValidator();
    error UnknownEpisode();
    error UnknownAsset();
    error NotAssetOwner();
    error DuplicateManifest();
    error EmptyManifestHash();
    error AlreadyValidated();
    error ScoreOutOfRange();

    constructor(AssetRegistry assetRegistry) {
        assets = assetRegistry;
        owner = msg.sender;
        isValidator[msg.sender] = true;
    }

    function _domainName() internal pure override returns (string memory) {
        return "WorldModEpisodeRegistry";
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setValidator(address validator, bool allowed) external onlyOwner {
        isValidator[validator] = allowed;
        emit ValidatorSet(validator, allowed);
    }

    function getEpisode(uint256 episodeId) external view returns (Episode memory) {
        if (episodeId == 0 || episodeId > episodeCount) revert UnknownEpisode();
        return _episodes[episodeId];
    }

    function getValidation(uint256 episodeId) external view returns (Validation memory) {
        if (episodeId == 0 || episodeId > episodeCount) revert UnknownEpisode();
        return _validations[episodeId];
    }

    /// @notice Submit an episode you own the asset for, paying your own gas.
    function submitEpisode(uint256 assetId, bytes32 bountyId, bytes32 manifestHash, string calldata storageURI)
        external
        returns (uint256)
    {
        return _submit(msg.sender, assetId, bountyId, manifestHash, storageURI);
    }

    /**
     * @notice Submit from the contributor's signature, with a relayer paying gas.
     * @dev The episode is attributed to the recovered signer. This is the path
     *      the phone takes: it signs the manifest hash it computed before any
     *      byte left the device, and never holds gas.
     */
    function submitEpisodeFor(
        address contributor,
        uint256 assetId,
        bytes32 bountyId,
        bytes32 manifestHash,
        string calldata storageURI,
        bytes calldata signature
    ) external returns (uint256) {
        bytes32 structHash = keccak256(
            abi.encode(
                _SUBMIT_TYPEHASH, assetId, bountyId, manifestHash, keccak256(bytes(storageURI)), nonces[contributor]
            )
        );

        _consumeSignature(contributor, structHash, signature);
        return _submit(contributor, assetId, bountyId, manifestHash, storageURI);
    }

    /// @notice Record what the validator found. Once per episode.
    function recordValidation(uint256 episodeId, uint16 score, TrustLevel trustLevel) external {
        if (!isValidator[msg.sender]) revert NotValidator();
        if (episodeId == 0 || episodeId > episodeCount) revert UnknownEpisode();
        if (score > 10_000) revert ScoreOutOfRange();

        // Immutable once written: a score that can be revised is a score a
        // buyer cannot rely on, and payments are settled against it.
        if (_validations[episodeId].recorded) revert AlreadyValidated();

        _validations[episodeId] = Validation({
            score: score,
            trustLevel: trustLevel,
            validator: msg.sender,
            validatedAt: uint64(block.timestamp),
            recorded: true
        });

        emit ValidationRecorded(episodeId, score, trustLevel, msg.sender);
    }

    function _submit(
        address contributor,
        uint256 assetId,
        bytes32 bountyId,
        bytes32 manifestHash,
        string calldata storageURI
    ) private returns (uint256 episodeId) {
        if (manifestHash == bytes32(0)) revert EmptyManifestHash();

        AssetRegistry.Asset memory asset = assets.getAsset(assetId);
        if (asset.registeredAt == 0) revert UnknownAsset();
        if (asset.owner != contributor) revert NotAssetOwner();

        // The same footage submitted twice is one contribution, not two.
        if (episodeByManifest[manifestHash] != 0) revert DuplicateManifest();

        episodeId = ++episodeCount;
        _episodes[episodeId] = Episode({
            assetId: assetId,
            contributor: contributor,
            bountyId: bountyId,
            manifestHash: manifestHash,
            storageURI: storageURI,
            submittedAt: uint64(block.timestamp)
        });
        episodeByManifest[manifestHash] = episodeId;

        emit EpisodeSubmitted(episodeId, assetId, contributor, manifestHash);
    }
}
