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
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, type Hex } from 'viem'
import { z } from 'zod'

// ─── Config Schema ──────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	appBaseUrl: z.string(),
	bountyId: z.string(),
	// Path, relative to appBaseUrl, of the training run that carries per-contributor
	// leave-one-contributor-out deltas. Fetched inside the enclave.
	resultsPath: z.string().default('/model-results.json'),
	secretIds: z.object({
		// The utility weighting policy: an exponent applied to each contributor's
		// delta before normalisation. Held by the Vault DON, released only into
		// the enclave — the economic shape of the split stays private.
		gammaId: z.string(),
	}),
	evms: z.array(
		z.object({
			chainSelectorName: z.string(),
			consumerAddress: z.string(),
			gasLimit: z.string().default('800000'),
		}),
	),
})
type Config = z.infer<typeof configSchema>

type UtilityRow = {
	entity_id: string
	delta: number | null
}

type ApiModelResults = {
	utility: UtilityRow[]
}

// ─── Logic to be executed over confidential data ────────────
// The sensitive values here are (1) the secret weighting exponent `gamma` and
// (2) the raw per-contributor `delta`s — the signal of how much each party's
// data actually mattered. Both stay in the enclave; only the normalised
// basis-point shares egress, exactly what BountyEscrow.settleUtility needs.
//
// shares ∝ delta^gamma, normalised to basis points that sum to EXACTLY 10000
// (settleUtility reverts otherwise). A largest-remainder pass assigns the
// rounding slack so the total is exact regardless of how the floors fall.
export const computeSharesBps = (deltas: number[], gamma: number): number[] => {
	const n = deltas.length
	if (n === 0) return []

	const weights = deltas.map((d) => (d > 0 ? Math.pow(d, gamma) : 0))
	const total = weights.reduce((a, b) => a + b, 0)

	// No positive signal anywhere → split evenly rather than emit all-zero shares
	// (which would fail settleUtility's "must total 10000" check).
	const fractions = total > 0 ? weights.map((w) => w / total) : weights.map(() => 1 / n)

	const exact = fractions.map((f) => f * 10_000)
	const floors = exact.map((x) => Math.floor(x))
	let assigned = floors.reduce((a, b) => a + b, 0)
	let remainder = 10_000 - assigned

	// Hand the remaining bps to the largest fractional parts, one each.
	const order = exact
		.map((x, i) => ({ i, frac: x - Math.floor(x) }))
		.sort((a, b) => b.frac - a.frac)

	const bps = floors.slice()
	for (let k = 0; k < order.length && remainder > 0; k++) {
		bps[order[k].i] += 1
		remainder--
	}
	return bps
}

const encodeUtilityReport = (bountyId: Hex, contributors: Hex[], sharesBps: number[]): Hex =>
	encodeAbiParameters(parseAbiParameters('bytes32 bountyId, address[] contributors, uint32[] sharesBps'), [
		bountyId,
		contributors,
		sharesBps,
	])

// ─── TEE Cron Callback ──────────────────────────────────────
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const { appBaseUrl, bountyId, resultsPath, secretIds, evms } = runtime.config
	const httpClient = new cre.capabilities.HTTPClient()

	// ── Step 1: Fetch the secret weighting policy inside the enclave ──
	const secrets = runtime.getSecrets([{ id: secretIds.gammaId }]).result()
	const gamma = Number(secrets[secretIds.gammaId].value)
	runtime.log('utility-oracle-getsecrets-ok')

	// ── Step 2: Pull the per-contributor deltas (public training output) ──
	const resultsResponse = httpClient.sendRequest(runtime, { url: `${appBaseUrl}${resultsPath}`, method: 'GET' }).result()
	if (!ok(resultsResponse)) throw new Error(`Results fetch failed with status: ${resultsResponse.statusCode}`)
	const { utility } = json(resultsResponse) as ApiModelResults

	const rows = utility.filter((r) => typeof r.entity_id === 'string' && r.delta !== null)
	if (rows.length === 0) {
		runtime.log('utility-oracle-skip no contributors with a delta')
		return JSON.stringify({ bountyId, settled: false, reason: 'no-contributors' })
	}

	// ── Step 3: Weight and normalise — in-enclave, over the secret gamma ──
	const contributors = rows.map((r) => r.entity_id as Hex)
	const sharesBps = computeSharesBps(
		rows.map((r) => r.delta as number),
		gamma,
	)
	const bountyIdHash = keccak256(toHex(bountyId))
	// Only the final shares are logged — never gamma or the raw deltas.
	runtime.log(`utility-oracle-shares contributors=${contributors.length} bps=${sharesBps.join(',')}`)

	// ── Step 4: Cross back to the DON and settle on-chain ──
	const evmConfig = evms[0]
	if (!evmConfig) {
		runtime.log('utility-oracle-skip-onchain no evms[0] configured')
		return JSON.stringify({ bountyId, settled: false, contributors, sharesBps })
	}

	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: evmConfig.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)

	const donRuntime = runtime.usingTheDons()
	const reportPayload = encodeUtilityReport(bountyIdHash, contributors, sharesBps)
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
	runtime.log(`utility-oracle-settled tx_hash=${txHash}`)
	return JSON.stringify({ bountyId, settled: true, contributors, sharesBps, txHash })
}

// ─── Workflow Init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
