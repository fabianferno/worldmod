// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChainlinkValidatorConsumer} from "../src/ChainlinkValidatorConsumer.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/**
 * Deploys ChainlinkValidatorConsumer — the on-chain receiver for the CRE
 * Confidential Workflow in `cre/episode-validator/` — and registers it as an
 * additional EpisodeRegistry validator, in one broadcast. The registry itself
 * is not redeployed; `setValidator` just grants the new consumer the right to
 * call `recordValidation` (caller must be the registry owner).
 *
 *   forge script script/DeployChainlinkValidatorConsumer.s.sol \
 *     --rpc-url "$SEPOLIA_RPC_URL" --broadcast \
 *     --sig "run(address,address,address)" <episodeRegistry> <creForwarder> <altForwarder>
 *
 * Two forwarders are accepted, mirroring the reference `perjury` VerdictSink
 * (CRE_REPORT_WRITER + ALT_REPORT_WRITER): the production `KeystoneForwarder`
 * and the tenant's mock forwarder, both from `cre workflow supported-chains`
 * (or the CRE forwarder directory,
 * https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts).
 * For Ethereum Sepolia those are 0xF8344CFd5c43616a4366C34E3EEE75af79a74482
 * (production) and 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 (mock). This lets
 * a report land whether delivered by the live DON or a mock/test path. Pass
 * the zero address for <altForwarder> to accept only the primary. Either slot
 * is rotatable later via setForwarder / setAltForwarder — no redeploy needed.
 */
contract DeployChainlinkValidatorConsumer is Script {
    function run(address episodeRegistryAddress, address creForwarder, address altForwarder) external {
        require(episodeRegistryAddress.code.length > 0, "EpisodeRegistry address has no code on this chain");
        require(creForwarder != address(0), "Forwarder is zero; pass the CRE forwarder or the deployer as a placeholder");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        EpisodeRegistry episodes = EpisodeRegistry(episodeRegistryAddress);
        require(episodes.owner() == deployer, "Deployer is not the EpisodeRegistry owner; setValidator would revert");

        console.log("Chain          ", block.chainid);
        console.log("Deployer       ", deployer);
        console.log("EpisodeRegistry", episodeRegistryAddress);
        console.log("CRE forwarder  ", creForwarder);
        console.log("Alt forwarder  ", altForwarder);

        vm.startBroadcast(deployerKey);

        ChainlinkValidatorConsumer consumer = new ChainlinkValidatorConsumer(episodes, creForwarder, altForwarder);
        episodes.setValidator(address(consumer), true);

        vm.stopBroadcast();

        console.log("");
        console.log("ChainlinkValidatorConsumer", address(consumer));
        console.log("Registered as an EpisodeRegistry validator: true");
        console.log("");
        console.log("Set this address as evms[0].consumerAddress in the workflow's");
        console.log("config.staging.json / config.production.json.");
        console.log("If a forwarder above is a placeholder, repoint it with");
        console.log("consumer.setForwarder / setAltForwarder before going live.");
    }
}
