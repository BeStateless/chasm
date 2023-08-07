import {
	lock,
	getPulumiOutputStream,
	logEngineEvent,
	sleep,
	isPresent,
} from "./utils";
import * as path from "path";
import * as fs from "fs";
import { ToSynthesize } from "./config";
import * as pulumi from "@pulumi/pulumi";

describe("deepFreeze", () => {
	it("should freeze a simple object", () => {
		const obj = { name: "John", age: 30 };
		const frozenObj = lock(obj);

		expect(Object.isFrozen(frozenObj)).toBe(true);
	});

	it("should freeze nested objects", () => {
		const obj = {
			name: "John",
			age: 30,
			address: {
				city: "New York",
				country: "USA",
			},
		};
		const frozenObj = lock(obj);

		expect(Object.isFrozen(frozenObj)).toBe(true);
		expect(Object.isFrozen(frozenObj.address)).toBe(true);
	});

	it("should return the same object if it is already frozen", () => {
		const obj = { name: "John", age: 30 };
		Object.freeze(obj);
		const frozenObj = lock(obj);

		expect(frozenObj).toBe(obj);
	});

	it("should return the same object if it is undefined or null", () => {
		const obj1 = undefined;
		const obj2 = null;
		const frozenObj1 = lock(obj1);
		const frozenObj2 = lock(obj2);

		expect(frozenObj1).toBe(obj1);
		expect(frozenObj2).toBe(obj2);
	});
});

// Tests specific to working directories
describe("workDir", () => {
	let workDir = fs.mkdtempSync("utils-test-work-dir");
	beforeEach(() => {
		workDir = fs.mkdtempSync("utils-test-work-dir");
	});

	it("log engine events yield expected pulumi-logs.out", async () => {
		const args: ToSynthesize = {
			meshName: "test",
			projectName: "project",
			accounts: [],
			psk: "",
			workDir,
			pulumiLogFile: path.join(workDir, "pulumi-logs.out"),
		};

		const stream = getPulumiOutputStream(args);

		const events: Array<pulumi.automation.EngineEvent> = [
			{
				sequence: 0,
				timestamp: 1000,
				preludeEvent: {
					config: { "aws:region": "mordor", "gcp-project": "project-runway" },
				},
			},
			{
				sequence: 1,
				timestamp: 1001,
				diagnosticEvent: {
					prefix: "debug: ",
					message: "Testing a pile of nonsense...",
					color: "never",
					severity: "info",
				},
			},
			{
				sequence: 2,
				timestamp: 1002,
				resourcePreEvent: {
					metadata: {
						op: "same",
						urn: "urn:pulumi:my-network::my-network::gcp:compute/forwardingRule:ForwardingRule::forwarding-rule/3/ipsec",
						type: "gcp:compute/forwardingRule:ForwardingRule",
						provider: "",
					},
				},
			},
			{
				sequence: 3,
				timestamp: 1003,
				resOutputsEvent: {
					metadata: {
						op: "same",
						urn: "urn:pulumi:my-network::my-network::aws:ec2/vpnGateway:VpnGateway::vpn-gateway/arbitrary-unique-id-aws1/vpc-2",
						type: "aws:ec2/vpnGateway:VpnGateway",
						provider:
							"urn:pulumi:my-network::my-network::pulumi:providers:aws::default_5",
					},
				},
			},
			{
				sequence: 4,
				timestamp: 1004,
				diagnosticEvent: {
					prefix: "debug: ",
					message: "Wait for it...",
					color: "never",
					severity: "info",
				},
			},
			{
				sequence: 5,
				timestamp: 1005,
				summaryEvent: {
					maybeCorrupt: false,
					durationSeconds: 1000,
					resourceChanges: { same: 15 },
					policyPacks: {},
				},
			},
			{ sequence: 6, timestamp: 1006, cancelEvent: {} },
		];
		try {
			for (const event of events) {
				logEngineEvent(stream, event);
			}
		} finally {
			stream.end();

			// wait for the write stream to be done before reading the file
			await new Promise((resolve) => stream.on("finish", resolve));
		}

		const logs = fs.readFileSync(args.pulumiLogFile, "utf-8").split("\n");
		// parse all nonempty lines as json objects into jsonLogs
		const jsonLogs = [];
		for (const log of logs) {
			if (log.length > 0) {
				jsonLogs.push(JSON.parse(log));
			}
		}
		expect(jsonLogs).toEqual(events);
	});
});
