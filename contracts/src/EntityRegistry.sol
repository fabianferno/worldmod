// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Relayable} from "./Relayable.sol";

/**
 * @title EntityRegistry
 * @notice Individuals and organizations that contribute physical-world data.
 *
 * Two properties drive the design.
 *
 * **No PII on-chain, ever.** Only a metadata URI is stored. Individuals may
 * stay pseudonymous; organizations may point their URI at verifiable
 * credentials. Nothing here should ever hold a name, an address or a face.
 *
 * **Contributors never send a transaction.** Registration is relayable: a
 * contributor signs an EIP-712 message on their phone and anyone may submit
 * it, with the entity attributed to the RECOVERED SIGNER rather than to
 * whoever paid the gas. That removes the entire paymaster problem from the
 * onboarding path — the wearer needs a key, not a funded account.
 */
contract EntityRegistry is Relayable {
    enum EntityType {
        Individual,
        Organization
    }

    struct Entity {
        address owner;
        EntityType entityType;
        string metadataURI;
        uint64 registeredAt;
    }

    /// @dev entityId is the owner address; one entity per key, and lookups need no index.
    mapping(address => Entity) private _entities;
    address[] private _owners;

    bytes32 private constant _REGISTER_TYPEHASH =
        keccak256("RegisterEntity(uint8 entityType,string metadataURI,uint256 nonce)");

    event EntityRegistered(address indexed entity, EntityType entityType, string metadataURI);
    event EntityUpdated(address indexed entity, string metadataURI);

    error AlreadyRegistered();
    error NotRegistered();

    function _domainName() internal pure override returns (string memory) {
        return "WorldModEntityRegistry";
    }

    function isRegistered(address entity) public view returns (bool) {
        return _entities[entity].registeredAt != 0;
    }

    function getEntity(address entity) external view returns (Entity memory) {
        if (!isRegistered(entity)) revert NotRegistered();
        return _entities[entity];
    }

    function entityCount() external view returns (uint256) {
        return _owners.length;
    }

    function entityAt(uint256 index) external view returns (address) {
        return _owners[index];
    }

    /// @notice Register yourself, paying your own gas.
    function registerEntity(EntityType entityType, string calldata metadataURI) external {
        _register(msg.sender, entityType, metadataURI);
    }

    /**
     * @notice Register on someone's behalf from their signature.
     * @dev The entity is attributed to the recovered signer, never to msg.sender.
     */
    function registerEntityFor(
        address entity,
        EntityType entityType,
        string calldata metadataURI,
        bytes calldata signature
    ) external {
        bytes32 structHash =
            keccak256(abi.encode(_REGISTER_TYPEHASH, uint8(entityType), keccak256(bytes(metadataURI)), nonces[entity]));

        _consumeSignature(entity, structHash, signature);
        _register(entity, entityType, metadataURI);
    }

    /// @notice Point at new metadata. Only the entity itself may do this.
    function updateMetadata(string calldata metadataURI) external {
        if (!isRegistered(msg.sender)) revert NotRegistered();
        _entities[msg.sender].metadataURI = metadataURI;
        emit EntityUpdated(msg.sender, metadataURI);
    }

    function _register(address entity, EntityType entityType, string calldata metadataURI) private {
        if (isRegistered(entity)) revert AlreadyRegistered();

        _entities[entity] =
            Entity({owner: entity, entityType: entityType, metadataURI: metadataURI, registeredAt: uint64(block.timestamp)});
        _owners.push(entity);

        emit EntityRegistered(entity, entityType, metadataURI);
    }
}
