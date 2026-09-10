import {
	bytesToHex,
	cre,
	getNetwork,
	json,
	ok,
	prepareReportRequest,
	TxStatus,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { z } from 'zod'

// ─── Config Schema ──────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	appBaseUrl: z.string(),
	bountyId: z.string(),
	secretIds: z.object({
		minFramingId: z.string(),
		minPlausibilityId: z.string(),
	}),
	evms: z.array(
		z.object({
			chainSelectorName: z.string(),
			consumerAddress: z.string(),
			gasLimit: z.string().default('500000'),
		}),
	),
})
type Config = z.infer<typeof configSchema>

/** Mirrors `EpisodeRegistry.TrustLevel`'s enum order exactly. */
const TRUST_LEVELS = ['self_reported', 'heuristic', 'attested', 'hardware']

type ApiEpisode = {
	episode_id: string
	status: string
	framing: number | null
	plausibility: number | null
	trust_level: string
	validation?: { plausibility_score: number }
	anchor?: { onchain_episode_id?: string }
}

type ApiBounty = {
	motion_policy: 'require' | 'allow_static'
}

// ─── Logic to be executed over confidential data ────────────
// The buyer's acceptance bar (min_framing / min_plausibility) is the sensitive
// value here: World Mod's public API no longer serves it, and it is fetched
// only as a secret, inside this enclave. Everything it's compared against —
// the episode's plausibility/framing score — is already public.
//
// Mirrors web/src/lib/market/acceptance.ts's evaluateEpisode, restricted to
// the two dimensions gated by a secret threshold; duration/deadline/trust
// level were already checked off-chain before an episode ever reaches here.
export const passesConfidentialBar = (
	episode: ApiEpisode,
	bounty: ApiBounty,
	minFraming: number,
	minPlausibility: number,
): boolean => {
	if (episode.framing === null || episode.framing < minFraming) return false

	if (episode.plausibility === null) {
		return bounty.motion_policy !== 'require'
	}
	return episode.plausibility >= minPlausibility
}

const encodeValidationReport = (episodeId: string, scoreBps: number, trustLevelIndex: number): Hex =>
	encodeAbiParameters(parseAbiParameters('uint256 episodeId, uint16 score, uint8 trustLevel'), [
		BigInt(episodeId),
		scoreBps,
		trustLevelIndex,
	])

// ─── TEE Cron Callback ──────────────────────────────────────
// Receives a `TeeRuntime`, not a `Runtime`. Everything here runs inside the
// enclave until we explicitly cross back with `usingTheDons()`.
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const { appBaseUrl, bountyId, secretIds, evms } = runtime.config
	const httpClient = new cre.capabilities.HTTPClient()

	// ── Step 2: Fetch secrets inside the enclave ──
	// The Vault DON releases these only into an attested enclave. Fetched in a
	// single batched call — the shape the confidential-workflows starter
	// template uses: `getSecrets([...]).result()` returns a map keyed by id.
	const secrets = runtime
		.getSecrets([{ id: secretIds.minFramingId }, { id: secretIds.minPlausibilityId }])
		.result()
	const minFraming = Number(secrets[secretIds.minFramingId].value)
	const minPlausibility = Number(secrets[secretIds.minPlausibilityId].value)
	runtime.log('episode-validator-getsecrets-ok')

	// ── Step 3: Capability calls from inside the enclave ──
	// motion_policy and the episode scores are already public (World Mod's API
	// no longer serves the threshold itself), so reading them here doesn't need
	// to stay confidential — only the two secret values above do.
	const bountyResponse = httpClient.sendRequest(runtime, { url: `${appBaseUrl}/api/bounties/${bountyId}`, method: 'GET' }).result()
	if (!ok(bountyResponse)) throw new Error(`Bounty fetch failed with status: ${bountyResponse.statusCode}`)
	const { bounty } = json(bountyResponse) as { bounty: ApiBounty }

	const episodesResponse = httpClient
		.sendRequest(runtime, { url: `${appBaseUrl}/api/episodes?bounty=${bountyId}`, method: 'GET' })
		.result()
	if (!ok(episodesResponse)) throw new Error(`Episodes fetch failed with status: ${episodesResponse.statusCode}`)
	const { episodes } = json(episodesResponse) as { episodes: ApiEpisode[] }

	const candidates = episodes.filter((e) => e.status === 'scored' && e.anchor?.onchain_episode_id)

	// ── Step 4: Cross back to the DON only for what needs consensus ──
	// A failing episode gets no call at all here: the absence of an on-chain
	// record *is* the reject verdict, so no threshold or margin is ever
	// inferable from what lands on-chain.
	const donRuntime = runtime.usingTheDons()
	const evmConfig = evms[0]
	const network = evmConfig ? getNetwork({ chainFamily: 'evm', chainSelectorName: evmConfig.chainSelectorName, isTestnet: true }) : undefined
	if (evmConfig && !network) throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)

	const results: { episodeId: string; verdict: 'pass' | 'fail'; txHash?: string }[] = []

	for (const episode of candidates) {
		const passed = passesConfidentialBar(episode, bounty, minFraming, minPlausibility)
		const onchainEpisodeId = episode.anchor!.onchain_episode_id!

		if (!passed) {
			runtime.log(`episode-validator-reject episode_id=${episode.episode_id}`)
			results.push({ episodeId: episode.episode_id, verdict: 'fail' })
			continue
		}

		if (!evmConfig || !network) {
			runtime.log(`episode-validator-skip-onchain episode_id=${episode.episode_id} no evms[0] configured`)
			results.push({ episodeId: episode.episode_id, verdict: 'pass' })
			continue
		}

		const scoreBps = Math.round((episode.validation?.plausibility_score ?? episode.framing ?? 0) * 10_000)
		const trustLevelIndex = Math.max(0, TRUST_LEVELS.indexOf(episode.trust_level))
		const reportPayload = encodeValidationReport(onchainEpisodeId, scoreBps, trustLevelIndex)

		const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
		const reportResponse = donRuntime.report(prepareReportRequest(reportPayload)).result()
		const writeResult = evmClient
			.writeReport(donRuntime, {
				receiver: evmConfig.consumerAddress,
				report: reportResponse,
				gasConfig: { gasLimit: evmConfig.gasLimit },
			})
			.result()

		if (writeResult.txStatus !== TxStatus.SUCCESS) {
			throw new Error(`onchain write failed with status ${writeResult.txStatus}`)
		}

		const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
		runtime.log(`episode-validator-pass episode_id=${episode.episode_id} tx_hash=${txHash}`)
		results.push({ episodeId: episode.episode_id, verdict: 'pass', txHash })
	}

	runtime.log(`episode-validator-complete candidates=${candidates.length}`)
	return JSON.stringify({ bountyId, results })
}

// ─── Workflow Init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		// AWS Nitro in us-west-2 is currently the only registered TEE type/region.
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
