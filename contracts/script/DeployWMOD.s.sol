// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {WMOD} from "../src/WMOD.sol";
import {ValidatorBond, IERC20} from "../src/ValidatorBond.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/**
 * Deploys WMOD (World Mod's native token) and ValidatorBond, wiring the token
 * to the existing validator set: a validator stakes WMOD in the bond, slashable
 * by the registry owner for bad validation. The slasher is set to the
 * EpisodeRegistry owner — the same authority that admits validators.
 *
 *   forge script script/DeployWMOD.s.sol \
 *     --rpc-url "$SEPOLIA_RPC_URL" --broadcast \
 *     --sig "run(address)" <episodeRegistry>
 */
contract DeployWMOD is Script {
    uint256 internal constant INITIAL_SUPPLY = 1_000_000 ether; // 1,000,000 WMOD
    uint256 internal constant MIN_BOND = 100 ether; // 100 WMOD to be a bonded validator

    function run(address episodeRegistryAddress) external {
        require(episodeRegistryAddress.code.length > 0, "EpisodeRegistry address has no code on this chain");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        EpisodeRegistry registry = EpisodeRegistry(episodeRegistryAddress);
        address slasher = registry.owner(); // the validator-admitting authority

        console.log("Chain        ", block.chainid);
        console.log("Deployer     ", deployer);
        console.log("EpisodeRegistry", episodeRegistryAddress);
        console.log("Slasher (registry owner)", slasher);

        vm.startBroadcast(deployerKey);

        WMOD token = new WMOD(INITIAL_SUPPLY);
        ValidatorBond bond = new ValidatorBond(IERC20(address(token)), registry, slasher, MIN_BOND);

        vm.stopBroadcast();

        console.log("");
        console.log("WMOD         ", address(token));
        console.log("ValidatorBond", address(bond));
        console.log("minBond (wei)", MIN_BOND);
        console.log("");
        console.log("Read methods for UI: token.balanceOf(addr), token.totalSupply(),");
        console.log("bond.bondOf(v), bond.minBond(), bond.isBonded(v), bond.isRegisteredValidator(v).");
        console.log("Add both to deployments.json + web config.");
    }
}
