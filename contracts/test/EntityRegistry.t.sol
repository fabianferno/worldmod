// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {Relayable} from "../src/Relayable.sol";

contract EntityRegistryTest is Test {
    EntityRegistry internal registry;

    uint256 internal contributorKey = 0xA11CE;
    address internal contributor;
    address internal relayer = address(0xBEEF);

    bytes32 private constant REGISTER_TYPEHASH =
        keccak256("RegisterEntity(uint8 entityType,string metadataURI,uint256 nonce)");

    function setUp() public {
        registry = new EntityRegistry();
        contributor = vm.addr(contributorKey);
    }

    function _sign(uint256 key, EntityRegistry.EntityType entityType, string memory uri, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(REGISTER_TYPEHASH, uint8(entityType), keccak256(bytes(uri)), nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_registersSelf() public {
        vm.prank(contributor);
        registry.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://meta");

        assertTrue(registry.isRegistered(contributor));
        assertEq(registry.getEntity(contributor).metadataURI, "ipfs://meta");
        assertEq(registry.entityCount(), 1);
    }

    function test_relayedRegistrationAttributesToSigner() public {
        // The property the whole design rests on: the contributor never sends a
        // transaction, and the entity belongs to them rather than to the relayer.
        bytes memory signature = _sign(contributorKey, EntityRegistry.EntityType.Individual, "ipfs://meta", 0);

        vm.prank(relayer);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://meta", signature);

        assertTrue(registry.isRegistered(contributor));
        assertFalse(registry.isRegistered(relayer));
        assertEq(registry.getEntity(contributor).owner, contributor);
    }

    function test_rejectsSignatureFromAnotherKey() public {
        bytes memory signature = _sign(0xB0B, EntityRegistry.EntityType.Individual, "ipfs://meta", 0);

        vm.expectRevert(Relayable.InvalidSignature.selector);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://meta", signature);
    }

    function test_rejectsTamperedMetadata() public {
        bytes memory signature = _sign(contributorKey, EntityRegistry.EntityType.Individual, "ipfs://meta", 0);

        // A relayer that swaps the metadata must not be able to register anything.
        vm.expectRevert(Relayable.InvalidSignature.selector);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://evil", signature);
    }

    function test_rejectsTamperedEntityType() public {
        bytes memory signature = _sign(contributorKey, EntityRegistry.EntityType.Individual, "ipfs://meta", 0);

        vm.expectRevert(Relayable.InvalidSignature.selector);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Organization, "ipfs://meta", signature);
    }

    function test_rejectsReplay() public {
        bytes memory signature = _sign(contributorKey, EntityRegistry.EntityType.Individual, "ipfs://meta", 0);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://meta", signature);

        // Nonce is consumed; the same signature is now worthless.
        vm.expectRevert(Relayable.InvalidSignature.selector);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://meta", signature);
    }

    function test_rejectsDuplicateRegistration() public {
        vm.startPrank(contributor);
        registry.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://meta");

        vm.expectRevert(EntityRegistry.AlreadyRegistered.selector);
        registry.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://other");
        vm.stopPrank();
    }

    function test_rejectsMalformedSignature() public {
        vm.expectRevert(Relayable.InvalidSignature.selector);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://meta", hex"00");
    }

    function test_rejectsMalleableSignature() public {
        // The same signature with s flipped to the upper half of the curve order
        // recovers a different address; accepting both would let one approval
        // register two distinct entities.
        bytes memory signature = _sign(contributorKey, EntityRegistry.EntityType.Individual, "ipfs://meta", 0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleable = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));

        vm.expectRevert(Relayable.InvalidSignature.selector);
        registry.registerEntityFor(contributor, EntityRegistry.EntityType.Individual, "ipfs://meta", malleable);
    }

    function test_onlyEntityCanUpdateItsMetadata() public {
        vm.prank(contributor);
        registry.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://meta");

        vm.prank(relayer);
        vm.expectRevert(EntityRegistry.NotRegistered.selector);
        registry.updateMetadata("ipfs://hijacked");

        vm.prank(contributor);
        registry.updateMetadata("ipfs://v2");
        assertEq(registry.getEntity(contributor).metadataURI, "ipfs://v2");
    }

    function test_gettingAnUnknownEntityReverts() public {
        vm.expectRevert(EntityRegistry.NotRegistered.selector);
        registry.getEntity(address(0xDEAD));
    }

    function test_domainSeparatorBindsToChainAndContract() public {
        bytes32 before = registry.domainSeparator();

        // A signature valid on one chain must not be valid on a fork.
        vm.chainId(block.chainid + 1);
        assertTrue(registry.domainSeparator() != before);
    }

    function testFuzz_anyKeyCanRegisterItself(uint256 key) public {
        key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        address who = vm.addr(key);
        vm.assume(!registry.isRegistered(who));

        bytes memory signature = _sign(key, EntityRegistry.EntityType.Individual, "ipfs://m", 0);
        registry.registerEntityFor(who, EntityRegistry.EntityType.Individual, "ipfs://m", signature);

        assertTrue(registry.isRegistered(who));
    }
}
