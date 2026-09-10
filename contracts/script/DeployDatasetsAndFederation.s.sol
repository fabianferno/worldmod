// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DatasetRegistry, IERC20Minimal as IERC20MinimalDatasets} from "../src/DatasetRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";
import {FederatedRound, IERC20Minimal as IERC20MinimalFederated} from "../src/FederatedRound.sol";

/**
 * Deploys DatasetRegistry and FederatedRound — the two core contracts
 * Deploy.s.sol never covered. They were deployed once by hand, undocumented
 * (contracts/deployments.json's Sepolia entry postdates the other four by a
 * week, with no forge script or command anywhere accounting for how). This
 * closes that gap for real: the same script works for any chain usdcFor()
 * knows about.
 *
 *   forge script script/DeployDatasetsAndFederation.s.sol \
 *     --rpc-url sepolia --broadcast --verify \
 *     --sig "run(address)" <episodeRegistryAddress>
 */
contract DeployDatasetsAndFederation is Script {
    /// @dev Mirrors Deploy.s.sol's usdcFor exactly — duplicated, not shared,
    /// same as IERC20Minimal is duplicated across DatasetRegistry.sol and
    /// FederatedRound.sol rather than imported from a shared file. Keep the
    /// two lists in sync if a new chain is added.
    function usdcFor(uint256 chainId) public pure returns (address) {
        if (chainId == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Ethereum Sepolia
        if (chainId == 84532) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia
        if (chainId == 421614) return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d; // Arbitrum Sepolia
        if (chainId == 11155420) return 0x5fd84259d66Cd46123540766Be93DFE6D43130D7; // Optimism Sepolia
        revert("No known USDC for this chain; add it before deploying.");
    }

    function run(address episodeRegistryAddress) external {
        address usdc = usdcFor(block.chainid);
        require(usdc.code.length > 0, "USDC address has no code on this chain");
        require(episodeRegistryAddress.code.length > 0, "EpisodeRegistry address has no code on this chain");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Chain          ", block.chainid);
        console.log("Deployer       ", deployer);
        console.log("USDC           ", usdc);
        console.log("EpisodeRegistry", episodeRegistryAddress);

        EpisodeRegistry episodes = EpisodeRegistry(episodeRegistryAddress);

        vm.startBroadcast(deployerKey);

        DatasetRegistry datasets = new DatasetRegistry(IERC20MinimalDatasets(usdc), episodes);
        FederatedRound federated = new FederatedRound(IERC20MinimalFederated(usdc));

        vm.stopBroadcast();

        console.log("");
        console.log("DatasetRegistry", address(datasets));
        console.log("FederatedRound ", address(federated));
    }
}
