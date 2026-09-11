// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChainlinkUtilityOracleConsumer, IBountyEscrow} from "../src/ChainlinkUtilityOracleConsumer.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

/**
 * Deploys ChainlinkUtilityOracleConsumer — the on-chain receiver for the CRE
 * Confidential Workflow in `cre/utility-oracle/` — and points BountyEscrow's
 * oracle at it, in one broadcast. The escrow itself is not redeployed;
 * `setOracle` transfers the right to call `settleUtility` from the trusted
 * operator EOA to this TEE/DON-attested consumer (caller must be the escrow
 * owner). This is reversible with another `setOracle`.
 *
 *   forge script script/DeployChainlinkUtilityOracleConsumer.s.sol \
 *     --rpc-url "$SEPOLIA_RPC_URL" --broadcast \
 *     --sig "run(address,address,address)" <bountyEscrow> <creForwarder> <altForwarder>
 *
 * Forwarders come from `cre workflow supported-chains` (or the CRE forwarder
 * directory). For Ethereum Sepolia: 0xF8344CFd5c43616a4366C34E3EEE75af79a74482
 * (production KeystoneForwarder) and 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
 * (mock). Pass the zero address for <altForwarder> to accept only the primary.
 */
contract DeployChainlinkUtilityOracleConsumer is Script {
    function run(address bountyEscrowAddress, address creForwarder, address altForwarder) external {
        require(bountyEscrowAddress.code.length > 0, "BountyEscrow address has no code on this chain");
        require(creForwarder != address(0), "Forwarder is zero; pass the CRE forwarder or the deployer as a placeholder");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        BountyEscrow escrow = BountyEscrow(bountyEscrowAddress);
        require(escrow.owner() == deployer, "Deployer is not the BountyEscrow owner; setOracle would revert");

        console.log("Chain        ", block.chainid);
        console.log("Deployer     ", deployer);
        console.log("BountyEscrow ", bountyEscrowAddress);
        console.log("Old oracle   ", escrow.oracle());
        console.log("CRE forwarder", creForwarder);
        console.log("Alt forwarder", altForwarder);

        vm.startBroadcast(deployerKey);

        ChainlinkUtilityOracleConsumer consumer =
            new ChainlinkUtilityOracleConsumer(IBountyEscrow(bountyEscrowAddress), creForwarder, altForwarder);
        escrow.setOracle(address(consumer));

        vm.stopBroadcast();

        console.log("");
        console.log("ChainlinkUtilityOracleConsumer", address(consumer));
        console.log("BountyEscrow.oracle now points at the consumer: true");
        console.log("");
        console.log("Set this address as evms[0].consumerAddress in the workflow's");
        console.log("cre/utility-oracle config.staging.json / config.production.json.");
    }
}
