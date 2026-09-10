import { describe, expect } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { initWorkflow, onCronTrigger, passesConfidentialBar } from './workflow'

const MIN_FRAMING = '0.7'
const MIN_PLAUSIBILITY = '0.7'

const makeConfig = () => ({
	schedule: '0 */5 * * * *',
	appBaseUrl: 'http://localhost:3000',
	bountyId: 'demo-hand-motion',
	secretIds: { minFramingId: 'MIN_FRAMING', minPlausibilityId: 'MIN_PLAUSIBILITY' },
	evms: [{ chainSelectorName: 'ethereum-testnet-sepolia', consumerAddress: '0x0000000000000000000000000000000000000001', gasLimit: '500000' }],
})

type FakeOptions = {
	bounty?: { motion_policy: 'require' | 'allow_static' }
	episodes?: Array<Record<string, unknown>>
}

// The public test surface does not yet ship a TEE runtime factory, so we
// stand up the small slice of `TeeRuntime` the handler actually uses:
// config, getSecrets, callCapability (HTTPClient.sendRequest goes through
// this), log, and usingTheDons.
const makeFakeTeeRuntime = ({
	bounty = { motion_policy: 'require' },
	episodes = [],
}: FakeOptions = {}) => {
	const reports: unknown[] = []
	const writes: unknown[] = []
	const logs: string[] = []
	const secretValues: Record<string, string> = { MIN_FRAMING, MIN_PLAUSIBILITY }

	const runtime = {
		config: makeConfig(),
		getSecrets: (requests: Array<{ id: string }>) => ({
			result: () => Object.fromEntries(requests.map((r) => [r.id, { id: r.id, value: secretValues[r.id] }])),
		}),
		callCapability: ({ payload }: { payload: { url?: string } }) => {
			const url = payload.url ?? ''
			const body = url.includes('/api/bounties/') ? { bounty } : { episodes }
			return {
				result: () => ({ statusCode: 200, body: new TextEncoder().encode(JSON.stringify(body)) }),
			}
		},
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: (input: unknown) => {
				reports.push(input)
				return { result: () => ({ signatures: [] }) }
			},
		}),
	}

	return {
		runtime: runtime as unknown as TeeRuntime<ReturnType<typeof makeConfig>>,
		reports,
		writes,
		logs,
	}
}

describe('onCronTrigger', () => {
	test('rejects an episode below the confidential framing bar without any on-chain call', () => {
		const { runtime, reports } = makeFakeTeeRuntime({
			episodes: [
				{
					episode_id: 'ep1',
					status: 'scored',
					framing: 0.3,
					plausibility: 0.9,
					trust_level: 'heuristic',
					anchor: { onchain_episode_id: '1' },
				},
			],
		})

		const result = JSON.parse(onCronTrigger(runtime))
		expect(result.results).toEqual([{ episodeId: 'ep1', verdict: 'fail' }])
		expect(reports).toHaveLength(0)
	})

	// A passing episode's on-chain write (donRuntime.report → evmClient.writeReport)
	// goes through the SDK's real protobuf-wrapped report plumbing, which this
	// lightweight hand-rolled TeeRuntime can't faithfully stand in for — that
	// path is exercised by `cre workflow simulate` instead, against the real
	// capability implementations. These unit tests cover the pure decision
	// logic: what does and doesn't clear the confidential bar, and that a
	// rejection never reaches the DON at all.

	test('rejects a null-motion episode when the bounty requires motion evidence', () => {
		const { runtime, reports } = makeFakeTeeRuntime({
			bounty: { motion_policy: 'require' },
			episodes: [
				{
					episode_id: 'ep3',
					status: 'scored',
					framing: 0.9,
					plausibility: null,
					trust_level: 'heuristic',
					anchor: { onchain_episode_id: '3' },
				},
			],
		})

		const result = JSON.parse(onCronTrigger(runtime))
		expect(result.results).toEqual([{ episodeId: 'ep3', verdict: 'fail' }])
		expect(reports).toHaveLength(0)
	})

	test('skips episodes that have not been anchored on-chain yet', () => {
		const { runtime, reports } = makeFakeTeeRuntime({
			episodes: [{ episode_id: 'ep4', status: 'scored', framing: 0.9, plausibility: 0.9, trust_level: 'heuristic' }],
		})

		const result = JSON.parse(onCronTrigger(runtime))
		expect(result.results).toEqual([])
		expect(reports).toHaveLength(0)
	})

	test('does not log the secret threshold values', () => {
		const { runtime, logs } = makeFakeTeeRuntime({
			episodes: [
				{
					episode_id: 'ep5',
					status: 'scored',
					framing: 0.3,
					plausibility: 0.9,
					trust_level: 'heuristic',
					anchor: { onchain_episode_id: '5' },
				},
			],
		})

		onCronTrigger(runtime)

		for (const line of logs) {
			expect(line).not.toContain(MIN_FRAMING)
			expect(line).not.toContain(MIN_PLAUSIBILITY)
		}
	})
})

describe('passesConfidentialBar', () => {
	test('passes when framing and plausibility both clear the bar', () => {
		expect(passesConfidentialBar({ framing: 0.9, plausibility: 0.9 } as never, { motion_policy: 'require' }, 0.7, 0.7)).toBe(true)
	})

	test('fails when framing is below the bar', () => {
		expect(passesConfidentialBar({ framing: 0.5, plausibility: 0.9 } as never, { motion_policy: 'require' }, 0.7, 0.7)).toBe(false)
	})

	test('fails when plausibility is below the bar', () => {
		expect(passesConfidentialBar({ framing: 0.9, plausibility: 0.2 } as never, { motion_policy: 'require' }, 0.7, 0.7)).toBe(false)
	})

	test('null plausibility passes under allow_static', () => {
		expect(passesConfidentialBar({ framing: 0.9, plausibility: null } as never, { motion_policy: 'allow_static' }, 0.7, 0.7)).toBe(true)
	})

	test('null plausibility fails under require', () => {
		expect(passesConfidentialBar({ framing: 0.9, plausibility: null } as never, { motion_policy: 'require' }, 0.7, 0.7)).toBe(false)
	})
})

describe('initWorkflow', () => {
	test('registers the cron handler with a Nitro TEE constraint', () => {
		const handlers = initWorkflow(makeConfig())

		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCronTrigger)
		expect(handlers[0].requirements).toBeDefined()
	})
})
