// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EntityRegistry} from "./EntityRegistry.sol";
import {Relayable} from "./Relayable.sol";

/**
 * @title AssetRegistry
 * @notice Registered sources of physical-world observation, with their capabilities.
 *
 * This is what makes "phone first, protocol general" real rather than
 * rhetorical: a phone and a factory sensor network register through the same
 * function and differ only in the modalities they declare.
 *
 * Capabilities are a bitmask rather than a list of strings. product-spec §11
 * sketches `getEligibleAssets(requiredModalities)`, but an on-chain function
 * that loops every registered asset is unbounded — it costs more as the network
 * grows and eventually cannot be called at all. The mask makes eligibility a
 * single AND, and enumeration belongs in the subgraph, which is built for it.
 */
contract AssetRegistry is Relayable {
    /// @dev Bit positions mirror product-spec §3.1's modality table.
    uint32 public constant MODALITY_RGB = 1 << 0;
    uint32 public constant MODALITY_IMU = 1 << 1;
    uint32 public constant MODALITY_AUDIO = 1 << 2;
    uint32 public constant MODALITY_GPS = 1 << 3;
    uint32 public constant MODALITY_ORIENTATION = 1 << 4;
    uint32 public constant MODALITY_DEPTH = 1 << 5;
    uint32 public constant MODALITY_POSE_6DOF = 1 << 6;
    uint32 public constant MODALITY_HANDS = 1 << 7;
    uint32 public constant MODALITY_FORCE = 1 << 8;
    uint32 public constant MODALITY_TELEMETRY = 1 << 9;

    struct Asset {
        address owner;
        string assetType;
        uint32 capabilities;
        string metadataURI;
        uint64 registeredAt;
        bool retired;
    }

    EntityRegistry public immutable entities;

    mapping(uint256 => Asset) private _assets;
    mapping(address => uint256[]) private _byOwner;
    uint256 public assetCount;

    bytes32 private constant _REGISTER_TYPEHASH =
        keccak256("RegisterAsset(string assetType,uint32 capabilities,string metadataURI,uint256 nonce)");

    event AssetRegistered(uint256 indexed assetId, address indexed owner, string assetType, uint32 capabilities);
    event AssetRetired(uint256 indexed assetId);

    error EntityNotRegistered();
    error NoCapabilities();
    error UnknownAsset();
    error NotAssetOwner();
    error AlreadyRetired();

    constructor(EntityRegistry entityRegistry) {
        entities = entityRegistry;
    }

    function _domainName() internal pure override returns (string memory) {
        return "WorldModAssetRegistry";
    }

    function getAsset(uint256 assetId) external view returns (Asset memory) {
        if (assetId == 0 || assetId > assetCount) revert UnknownAsset();
        return _assets[assetId];
    }

    function assetsOf(address owner) external view returns (uint256[] memory) {
        return _byOwner[owner];
    }

    /**
     * @notice Whether an asset can satisfy a bounty's required modalities.
     * @dev Constant cost regardless of network size, unlike an enumerating query.
     */
    function supportsModalities(uint256 assetId, uint32 requiredModalities) external view returns (bool) {
        Asset storage asset = _assets[assetId];
        if (asset.registeredAt == 0 || asset.retired) return false;
        return (asset.capabilities & requiredModalities) == requiredModalities;
    }

    function registerAsset(string calldata assetType, uint32 capabilities, string calldata metadataURI)
        external
        returns (uint256)
    {
        return _register(msg.sender, assetType, capabilities, metadataURI);
    }

    /// @notice Register an asset from its owner's signature; gas paid by anyone.
    function registerAssetFor(
        address owner,
        string calldata assetType,
        uint32 capabilities,
        string calldata metadataURI,
        bytes calldata signature
    ) external returns (uint256) {
        bytes32 structHash = keccak256(
            abi.encode(
                _REGISTER_TYPEHASH, keccak256(bytes(assetType)), capabilities, keccak256(bytes(metadataURI)), nonces[owner]
            )
        );

        _consumeSignature(owner, structHash, signature);
        return _register(owner, assetType, capabilities, metadataURI);
    }

    /// @notice Retire an asset. Its episodes remain; it simply accepts no new ones.
    function retireAsset(uint256 assetId) external {
        Asset storage asset = _assets[assetId];
        if (asset.registeredAt == 0) revert UnknownAsset();
        if (asset.owner != msg.sender) revert NotAssetOwner();
        if (asset.retired) revert AlreadyRetired();

        asset.retired = true;
        emit AssetRetired(assetId);
    }

    function _register(address owner, string calldata assetType, uint32 capabilities, string calldata metadataURI)
        private
        returns (uint256 assetId)
    {
        // An asset must belong to a registered entity: episodes are attributed
        // through the asset, and an orphaned asset would produce data nobody
        // can be paid for.
        if (!entities.isRegistered(owner)) revert EntityNotRegistered();

        // A capability-less asset can never satisfy any bounty, so registering
        // one is always a mistake.
        if (capabilities == 0) revert NoCapabilities();

        assetId = ++assetCount;
        _assets[assetId] = Asset({
            owner: owner,
            assetType: assetType,
            capabilities: capabilities,
            metadataURI: metadataURI,
            registeredAt: uint64(block.timestamp),
            retired: false
        });
        _byOwner[owner].push(assetId);

        emit AssetRegistered(assetId, owner, assetType, capabilities);
    }
}
