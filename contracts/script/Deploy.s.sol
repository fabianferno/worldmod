// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {BountyEscrow, IERC20} from "../src/BountyEscrow.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/**
 * Deploys the four core contracts to a testnet.
 *
 *   forge script script/Deploy.s.sol --rpc-url hedera_testnet --broadcast --verify
 *
 * USDC is never deployed. Each supported chain names Circle's real token, so
 * the escrow settles in the same asset a buyer actually holds — a stand-in
 * would make every payment in the demo meaningless. Hedera testnet's USDC
 * (0.0.429274, a Hedera Token Service token — not a plain ERC-20) is the
 * primary target as of the Sepolia-to-Hedera migration; Sepolia stays listed
 * as the rollback fallback (see contracts/deployments.json's "11155111"
 * entry, kept alongside the new "296" one, not replaced).
 */
contract Deploy is Script {
    /// @dev Circle's official USDC per chain.
    function usdcFor(uint256 chainId) public pure returns (address) {
        if (chainId == 296) return 0x0000000000000000000000000000000000068cDa; // Hedera testnet (HTS 0.0.429274)
        if (chainId == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Ethereum Sepolia
        if (chainId == 84532) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia
        if (chainId == 421614) return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d; // Arbitrum Sepolia
        if (chainId == 11155420) return 0x5fd84259d66Cd46123540766Be93DFE6D43130D7; // Optimism Sepolia
        revert("No known USDC for this chain; add it before deploying.");
    }

    function run() external {
        address usdc = usdcFor(block.chainid);

        // Fail before broadcasting rather than after: a deploy against an
        // address with no code would leave four live contracts pointing at
        // nothing, and they cannot be repointed.
        require(usdc.code.length > 0, "USDC address has no code on this chain");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Chain          ", block.chainid);
        console.log("Deployer       ", deployer);
        console.log("Deployer balance", deployer.balance);
        console.log("USDC           ", usdc);

        vm.startBroadcast(deployerKey);

        EntityRegistry entities = new EntityRegistry();
        AssetRegistry assets = new AssetRegistry(entities);
        EpisodeRegistry episodes = new EpisodeRegistry(assets);
        BountyEscrow escrow = new BountyEscrow(IERC20(usdc), episodes);

        vm.stopBroadcast();

        console.log("");
        console.log("EntityRegistry ", address(entities));
        console.log("AssetRegistry  ", address(assets));
        console.log("EpisodeRegistry", address(episodes));
        console.log("BountyEscrow   ", address(escrow));
        console.log("");
        console.log("The deployer is the episode registry's owner and its first");
        console.log("validator. Add the validator service key with setValidator.");
        console.log("");
        console.log("BountyEscrow self-associates with USDC in its own constructor");
        console.log("on chains with the Hedera Token Service precompile (0x167),");
        console.log("a no-op elsewhere. Confirm via the mirror node, don't assume:");
        console.log("  GET /api/v1/accounts/<escrow>/tokens?token.id=0.0.429274");
    }
}
