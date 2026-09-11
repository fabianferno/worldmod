import { describe, expect } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { computeSharesBps, initWorkflow, onCronTrigger } from './workflow'

const GAMMA = '1'

const makeConfig = () => ({
	schedule: '0 */5 * * * *',
	appBaseUrl: 'http://localhost:3000',
	bountyId: 'bounty_keyboard_001',
	resultsPath: '/model-results.json',
	secretIds: { gammaId: 'UTILITY_GAMMA' },
	evms: [
		{
			chainSelectorName: 'ethereum-testnet-sepolia',
			consumerAddress: '0x0000000000000000000000000000000000000001',
			gasLimit: '800000',
		},
	],
})

type FakeOptions = { utility?: Array<Record<string, unknown>>; gamma?: string }

const makeFakeTeeRuntime = ({ utility = [], gamma = GAMMA }: FakeOptions = {}) => {
	const logs: string[] = []
	const secretValues: Record<string, string> = { UTILITY_GAMMA: gamma }

	const runtime = {
		config: makeConfig(),
		getSecrets: (requests: Array<{ id: string }>) => ({
			result: () => Object.fromEntries(requests.map((r) => [r.id, { id: r.id, value: secretValues[r.id] }])),
		}),
		callCapability: () => ({
			result: () => ({ statusCode: 200, body: new TextEncoder().encode(JSON.stringify({ utility })) }),
		}),
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: () => ({ result: () => ({ signatures: [] }) }),
		}),
	}

	return { runtime: runtime as unknown as TeeRuntime<ReturnType<typeof makeConfig>>, logs }
}

describe('computeSharesBps', () => {
	test('normalises to basis points that total exactly 10000', () => {
		const bps = computeSharesBps([0.9838733375, 0.15716356], 1)
		expect(bps.reduce((a, b) => a + b, 0)).toBe(10_000)
		// The larger delta gets the larger share.
		expect(bps[0]).toBeGreaterThan(bps[1])
	})

	test('gamma > 1 sharpens the split toward the top contributor', () => {
		const linear = computeSharesBps([0.8, 0.2], 1)
		const sharpened = computeSharesBps([0.8, 0.2], 3)
		expect(sharpened[0]).toBeGreaterThan(linear[0])
		expect(sharpened.reduce((a, b) => a + b, 0)).toBe(10_000)
	})

	test('all-zero deltas split evenly rather than emit an invalid all-zero report', () => {
		const bps = computeSharesBps([0, 0, 0], 1)
		expect(bps.reduce((a, b) => a + b, 0)).toBe(10_000)
		expect(bps).toEqual([3334, 3333, 3333])
	})

	test('single contributor gets the whole pool', () => {
		expect(computeSharesBps([0.42], 2)).toEqual([10_000])
	})

	test('odd remainders still sum to exactly 10000', () => {
		const bps = computeSharesBps([1, 1, 1], 1)
		expect(bps.reduce((a, b) => a + b, 0)).toBe(10_000)
	})
})

describe('onCronTrigger', () => {
	test('skips when no contributor has a delta', () => {
		const { runtime } = makeFakeTeeRuntime({
			utility: [{ entity_id: '0x29848D4ff3532211663f7ff658dD5DE7ddE5F508', delta: null }],
		})
		const result = JSON.parse(onCronTrigger(runtime))
		expect(result.settled).toBe(false)
		expect(result.reason).toBe('no-contributors')
	})

	test('does not log gamma or raw deltas', () => {
		const secretGamma = '2.5'
		const { runtime, logs } = makeFakeTeeRuntime({
			gamma: secretGamma,
			utility: [
				{ entity_id: '0x29848D4ff3532211663f7ff658dD5DE7ddE5F508', delta: 0.9838733375 },
				{ entity_id: '0xa0bc402bf88aee08c020a55193a67c37712a5865', delta: 0.15716356 },
			],
		})
		// No evms[0] delivery in this fake path past report(); we only assert logging hygiene.
		try {
			onCronTrigger(runtime)
		} catch {
			// The hand-rolled runtime can't complete writeReport; logging happens before that.
		}
		for (const line of logs) {
			expect(line).not.toContain(secretGamma)
			expect(line).not.toContain('0.9838733375')
			expect(line).not.toContain('0.15716356')
		}
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
