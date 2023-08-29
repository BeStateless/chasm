import * as pulumi from "@pulumi/pulumi";

let awsCounter = 0;
let forwardingCounter = 0;

pulumi.runtime.setMocks({
    newResource: function(args: pulumi.runtime.MockResourceArgs): {id: string, state: any} {
		switch (args.type) {
            case "aws:ec2/vpnGateway:VpnGateway":
				awsCounter++;
                return {
                    id: `sg-111111-${awsCounter}`,
                    state: {
                        ...args.inputs,
                        id: `sg-111111-${awsCounter}`,
                        name: args.name + "-sg", //args.inputs.name || args.name + "-sg",
                    },
                };
			case "azure-native:network:VirtualNetworkGateway":
				return {
					id: "sg-87654321",
					state: {
						...args.inputs,
						id: "sg-87654321",
						name: args.inputs.name || args.name,
					},
				};
			case "gcp:compute/vPNGateway:VPNGateway":
				return {
					id: "sg-55555555",
					state: {
						...args.inputs,
						id: "sg-55555555",
					},
				};
			case "azure-native:network:PublicIPAddress":
				return {
					id: "sg-22222222",
					state: {
						...args.inputs,
						id: "sg-22222222",
						ipAddress: "10.0.2.2",
					},
				};
			case "gcp:compute/address:Address":
				return {
					id: "sg-66666666",
					state: {
						...args.inputs,
						id: "sg-66666666",
						labels: args.inputs.tags,
						address: "172.16.129.1",
					},
				};
			case "gcp:compute/forwardingRule:ForwardingRule":
				forwardingCounter++;
				return {
					id: `forwarding-rule-${forwardingCounter}`,
					state: {
						...args.inputs,
						id: `forwarding-rule-${forwardingCounter}`,
						// portRange: isPresent(args.inputs.portRange) ? args.inputs.portRange : undefined,
					},
				};
		default:
			return {
				id: `unknown-resource-${args.type}`,
				state: {
					// NOTE: id is chosen to make it easy to debug problems
					id: `unknown-resource-${args.type}`,
					...args.inputs,
				},
			};
		}
    },
    call: function(args: pulumi.runtime.MockCallArgs) {
        switch (args.token) {
            case "aws:ec2/getAmi:getAmi":
                return {
                    "architecture": "x86_64",
                    "id": "ami-0eb1f3cdeeb8eed2a",
                };
			case "azure-native:network:getSubnet":
				return {
					id: "subnet-1234-abcd-5678-90ef",
					...args.inputs
				};
			case "gcp:compute/getNetwork:getNetwork":
				return {
					id: "network-5678-1234-abcd-90ef",
					...args.inputs
				};
			default:
                return {
					// NOTE: id is chosen to make it easy to debug problems
					id: `undefined-call-${args.token}`,
					...args.inputs
				};
        }
    },
},
  "project",
  "stack",
  /* preview = */ false,
);

// Convert a pulumi.Output to a promise of the same type.
function promiseOf<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(resolve => output.apply(resolve));
}

import * as aws from "@pulumi/aws";
import { AwsVpc, Config, GcpSubnet, GcpVpc } from "../types/new-types";
import {
	AccountType,
	VpcType,
	AwsPhaseOneVpc,
	AzurePhaseOneVpc,
	GcpPhaseOneVpc,
	PhaseOneAccount,
	buildPhase1Result,
	GcpPhaseOneResource,
	AzurePhaseOneResource,
	AwsPhaseOneResource,
} from "./phase-one";
import { isPresent } from "../utils";

function outputOnOutsideAws(resource: AwsPhaseOneResource) {
	return pulumi.all([resource.vpnGateway.id, resource.vpnGateway.vpcId, resource.vpnGateway.tags]).apply(([
		id, vpcId, tags
	]) => {
		return pulumi.output({
			vpnGateway: {
				id,
				vpcId,
				tags
			},
		});
	});
}

function outputOnOutsideGcp(resource: GcpPhaseOneResource) {
	// NOTE: pulumi.all() and apply() have a cap for max # of static parameters you can pass into
	// them. Therefore, we build one object just with the forwardingRules and pass that into a
	// subsequent invocation on pulumi.all() and apply() using the remainder of the attributes.
	// This is the simplest way to work around this limit.
	const forwardingRules = pulumi.all([
		resource.forwardingRules.esp.id,
		resource.forwardingRules.esp.name,
		resource.forwardingRules.esp.ipAddress,
		resource.forwardingRules.esp.ipProtocol,
		resource.forwardingRules.esp.region,
		resource.forwardingRules.esp.target,
		resource.forwardingRules.esp.portRange,

		resource.forwardingRules.ipsec.id,
		resource.forwardingRules.ipsec.name,
		resource.forwardingRules.ipsec.ipAddress,
		resource.forwardingRules.ipsec.ipProtocol,
		resource.forwardingRules.ipsec.region,
		resource.forwardingRules.ipsec.target,
		resource.forwardingRules.ipsec.portRange,

		resource.forwardingRules.ipsecNat.id,
		resource.forwardingRules.ipsecNat.name,
		resource.forwardingRules.ipsecNat.ipAddress,
		resource.forwardingRules.ipsecNat.ipProtocol,
		resource.forwardingRules.ipsecNat.region,
		resource.forwardingRules.ipsecNat.target,
		resource.forwardingRules.ipsecNat.portRange,

	]).apply(([
		forwardingRulesEspId,
		forwardingRulesEspName,
		forwardingRulesEspIpAddress,
		forwardingRulesEspIpProtocol,
		forwardingRulesEspRegion,
		forwardingRulesEspTarget,
		forwardingRulesEspPortRange,

		forwardingRulesIpSecId,
		forwardingRulesIpSecName,
		forwardingRulesIpSecIpAddress,
		forwardingRulesIpSecIpProtocol,
		forwardingRulesIpSecRegion,
		forwardingRulesIpSecTarget,
		forwardingRulesIpSecPortRange,

		forwardingRulesIpSecNatId,
		forwardingRulesIpSecNatName,
		forwardingRulesIpSecNatIpAddress,
		forwardingRulesIpSecNatIpProtocol,
		forwardingRulesIpSecNatRegion,
		forwardingRulesIpSecNatTarget,
		forwardingRulesIpSecNatPortRange,
	]) => {
		return pulumi.output({
			esp: {
				id: forwardingRulesEspId,
				name: forwardingRulesEspName,
				ipAddress: forwardingRulesEspIpAddress,
				ipProtocol: forwardingRulesEspIpProtocol,
				region: forwardingRulesEspRegion,
				target: forwardingRulesEspTarget,
				portRange: forwardingRulesEspPortRange,
			},
			ipSec: {
				id: forwardingRulesIpSecId,
				name: forwardingRulesIpSecName,
				ipAddress: forwardingRulesIpSecIpAddress,
				ipProtocol: forwardingRulesIpSecIpProtocol,
				region: forwardingRulesIpSecRegion,
				target: forwardingRulesIpSecTarget,
				portRange: forwardingRulesIpSecPortRange,
			},
			ipSecNat: {
				id: forwardingRulesIpSecNatId,
				name: forwardingRulesIpSecNatName,
				ipAddress: forwardingRulesIpSecNatIpAddress,
				ipProtocol: forwardingRulesIpSecNatIpProtocol,
				region: forwardingRulesIpSecNatRegion,
				target: forwardingRulesIpSecNatTarget,
				portRange: forwardingRulesIpSecNatPortRange,
			},
		});
	});

	return pulumi.all([
		resource.network,
		resource.vpnGateway.id,
		resource.vpnGateway.region,
		resource.vpnGateway.name,
		resource.publicIp.id,
		resource.publicIp.address,
		resource.publicIp.labels,
		forwardingRules,
	]).apply(([
		network,
		vpnGatewayId,
		vpnGatewayRegion,
		vpnGatewayName,
		publicIpId,
		publicIpAddress,
		publicIpLabels,
		forwardingRules,
	]) => {
		return pulumi.output({
			network,
			vpnGateway: {
				id: vpnGatewayId,
				region: vpnGatewayRegion,
				name: vpnGatewayName
			},
			publicIp: {
				id: publicIpId,
				address: publicIpAddress,
				labels: publicIpLabels,
			},
			// NOTE: Only esp attribute is preserved if forwardingRules shorthand is used here, not
			// sure why. To make sure ipsec and ipsecNat are preserved too, we name explicitly name
			// all 3 outer object attributes we care about.
			forwardingRules: {
				esp: forwardingRules.esp,
				ipsec: forwardingRules.ipSec,
				ipsecNat: forwardingRules.ipSecNat,
			},
		});
	});
}

// function outputOnOutsideAzure(resource: AzurePhaseOneResource) {
// 	pulumi.all([resource.vpnGateway.id, resource.vpnGateway.vpcId, resource.vpnGateway.tags]).apply(([
// 		id, vpcId, tags
// 	]) => {
// 		return pulumi.output({
// 			vpnGateway: {
// 				id,
// 				vpcId,
// 				tags
// 			},
// 		});
// 	});
// }

describe("PhaseOneAccount", () => {
	const config: Config = [
		{
			type: "AwsAccount",
			id: "arbitrary-unique-id-aws1",
			region: "us-east-1",
			vpcs: [
				{
					id: "vpc-12345678",
					tags: {
						"managed-by": "chasm",
					},
					type: "AwsVpc",
					region: "us-east-1",
					cidr: "172.1.0.0/16",
					subnets: [
						{
							id: "subnet-00000001",
							cidr: "172.1.1.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000002",
							cidr: "172.1.2.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000003",
							cidr: "172.1.3.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000004",
							cidr: "172.1.4.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000005",
							cidr: "172.1.5.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000006",
							cidr: "172.1.6.0/24",
							type: "AwsSubnet",
						},
					],
				},
				{
					id: "vpc-87654321",
					tags: {
						"managed-by": "chasm",
					},
					type: "AwsVpc",
					region: "us-east-1",
					cidr: "172.2.0.0/16",
					subnets: [
						{
							id: "subnet-00000011",
							cidr: "172.2.1.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000012",
							cidr: "172.2.2.0/24",
							type: "AwsSubnet",
						},
						{
							id: "subnet-00000013",
							cidr: "172.2.3.0/24",
							type: "AwsSubnet",
						},
					],
				},
			],
		},
		{
			type: "GcpAccount",
			id: "arbitrary-unique-id-gcp1",
			project: "my-project",
			vpcs: [
				{
					id: "12345678901234567",
					tags: {
						"managed-by": "chasm",
					},
					type: "GcpVpc",
					projectName: "my-project",
					networkName: "my-project-vpc",
					subnets: [
						{
							id: "1111111111111111111",
							cidr: "30.30.30.0/24",
							type: "GcpSubnet",
							region: "us-west4",
						},
					],
				},
			],
		},
		{
			type: "AzureAccount",
			id: "arbitrary-unique-id-az1",
			subscriptionId: "12345678-9abc-def0-1234-56789abcdef0",
			vpcs: [
				{
					id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678",
					tags: {
						"managed-by": "chasm",
					},
					type: "AzureVpc",
					region: "southcentralus",
					resourceGroupName:
						"/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg",
					subnets: [
						{
							id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678/subnets/test-resource-rg-subnet-1",
							cidr: "10.10.1.0/24",
							type: "AzureSubnet",
						},
						{
							id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678/subnets/test-resource-rg-subnet-2",
							cidr: "10.10.2.0/24",
							type: "AzureSubnet",
						},
					],
				},
			],
		},
	];

	const awsPhaseOneVpc1 = {
		type: VpcType.AwsVpc,
		cidrs: [
			"172.1.1.0/24",
			"172.1.2.0/24",
			"172.1.3.0/24",
			"172.1.4.0/24",
			"172.1.5.0/24",
			"172.1.6.0/24",
		],
		subnets: [
			{
				id: "subnet-00000001",
				cidr: "172.1.1.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000002",
				cidr: "172.1.2.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000003",
				cidr: "172.1.3.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000004",
				cidr: "172.1.4.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000005",
				cidr: "172.1.5.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000006",
				cidr: "172.1.6.0/24",
				type: "AwsSubnet",
			},
		],
		vpc: AwsVpc.parse({
			id: "vpc-12345678",
			tags: {
				"managed-by": "chasm",
			},
			type: "AwsVpc",
			region: "us-east-1",
			cidr: "172.1.0.0/16",
			subnets: [
				{
					id: "subnet-00000001",
					cidr: "172.1.1.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000002",
					cidr: "172.1.2.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000003",
					cidr: "172.1.3.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000004",
					cidr: "172.1.4.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000005",
					cidr: "172.1.5.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000006",
					cidr: "172.1.6.0/24",
					type: "AwsSubnet",
				},
			],
		}),
	};

	const awsVpc1Resources = //: AwsPhaseOneResource =
	{
		vpnGateway: {
			id: "sg-111111-1",
			vpcId: "vpc-12345678",
			tags: {
				"managed-by": "chasm",
			},

			// id: pulumi.output("sg-111111-1"),
			// vpcId: pulumi.output("vpc-12345678"),
			// tags: pulumi.output({
			// 	"managed-by": "chasm",
			// }),
		},
	};

	const awsPhaseOneVpc2 = {
		type: VpcType.AwsVpc,
		cidrs: ["172.2.1.0/24", "172.2.2.0/24", "172.2.3.0/24"],
		subnets: [
			{
				id: "subnet-00000011",
				cidr: "172.2.1.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000012",
				cidr: "172.2.2.0/24",
				type: "AwsSubnet",
			},
			{
				id: "subnet-00000013",
				cidr: "172.2.3.0/24",
				type: "AwsSubnet",
			},
		],
		vpc: {
			id: "vpc-87654321",
			tags: {
				"managed-by": "chasm",
			},
			type: "AwsVpc",
			region: "us-east-1",
			cidr: "172.2.0.0/16",
			subnets: [
				{
					id: "subnet-00000011",
					cidr: "172.2.1.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000012",
					cidr: "172.2.2.0/24",
					type: "AwsSubnet",
				},
				{
					id: "subnet-00000013",
					cidr: "172.2.3.0/24",
					type: "AwsSubnet",
				},
			],
		},
	};

	const awsVpc2Resources = //: AwsPhaseOneResource =
	{
		vpnGateway: {
			id: "sg-111111-2",
			vpcId: "vpc-87654321",
			tags: {
				"managed-by": "chasm",
			},

			// id: pulumi.output("sg-111111-2"),
			// vpcId: pulumi.output("vpc-87654321"),
			// tags: pulumi.output({
			// 	"managed-by": "chasm",
			// }),
		},
	};

	const gcpPhaseOneVpc = {
		type: VpcType.GcpVpc,
		region: "us-west4",
		vpnName: "12345678901234567",
		cidrs: ["30.30.30.0/24"],
		subnets: [
			GcpSubnet.parse({
				id: "1111111111111111111",
				cidr: "30.30.30.0/24",
				type: "GcpSubnet",
				region: "us-west4",
			}),
		],
		vpc: GcpVpc.parse({
			id: "12345678901234567",
			tags: {
				"managed-by": "chasm",
			},
			type: "GcpVpc",
			projectName: "my-project",
			networkName: "my-project-vpc",
			subnets: [
				{
					id: "1111111111111111111",
					cidr: "30.30.30.0/24",
					type: "GcpSubnet",
					region: "us-west4",
				},
			],
		}),
	};

	const gcpVpcResources = //: GcpPhaseOneResource =
	{
		network: {
			id: "network-5678-1234-abcd-90ef",
			name: "my-project-vpc",
		},
		vpnGateway: {
			id: "sg-55555555",
			region: "us-west4",
			name: "a-12345678901234567",
		},
		publicIp: {
			id: "sg-66666666",
			address: "172.16.129.1",
			labels: {
				"managed-by": "chasm",
			},
		},
		forwardingRules: {
			esp: {
				id: "forwarding-rule-1",
				name: "a-12345678901234567-esp",
				ipAddress: "172.16.129.1",
				ipProtocol: "ESP",
				region: "us-west4",
				target: "sg-55555555",
			},
			ipsec: {
				id: "forwarding-rule-2",
				name: "a-12345678901234567-ipsec",
				ipAddress: "172.16.129.1",
				ipProtocol: "UDP",
				region: "us-west4",
				portRange: "500",
				target: "sg-55555555",
			},
			ipsecNat: {
				id: "forwarding-rule-3",
				name: "a-12345678901234567-ipsecnat",
				ipAddress: "172.16.129.1",
				ipProtocol: "UDP",
				region: "us-west4",
				portRange: "4500",
				target: "sg-55555555",
			},
		},

		// network: pulumi.output({
		// 	id: "network-5678-1234-abcd-90ef",
		// 	name: "my-project-vpc",
		// }),
		// vpnGateway: {
		// 	id: pulumi.output("sg-55555555"),
		// 	region: pulumi.output("us-west4"),
		// 	name: pulumi.output("a-12345678901234567"),
		// },
		// publicIp: {
		// 	id: pulumi.output("sg-66666666"),
		// 	address: pulumi.output("172.16.129.1"),
		// 	labels: pulumi.output({
		// 		"managed-by": "chasm",
		// 	}),
		// },
		// forwardingRules: {
		// 	esp: {
		// 		id: pulumi.output("forwarding-rule-1"),
		// 		name: pulumi.output("a-12345678901234567-esp"),
		// 		ipAddress: pulumi.output("172.16.129.1"),
		// 		ipProtocol: pulumi.output("ESP"),
		// 		region: pulumi.output("us-west4"),
		// 		target: pulumi.output("sg-55555555"),
		// 	},
		// 	ipsec: {
		// 		id: pulumi.output("forwarding-rule-2"),
		// 		name: pulumi.output("a-12345678901234567-ipsec"),
		// 		ipAddress: pulumi.output("172.16.129.1"),
		// 		ipProtocol: pulumi.output("UDP"),
		// 		region: pulumi.output("us-west4"),
		// 		portRange: pulumi.output("500"),
		// 		target: pulumi.output("sg-55555555"),
		// 	},
		// 	ipsecNat: {
		// 		id: pulumi.output("forwarding-rule-3"),
		// 		name: pulumi.output("a-12345678901234567-ipsecnat"),
		// 		ipAddress: pulumi.output("172.16.129.1"),
		// 		ipProtocol: pulumi.output("UDP"),
		// 		region: pulumi.output("us-west4"),
		// 		portRange: pulumi.output("4500"),
		// 		target: pulumi.output("sg-55555555"),
		// 	},
		// },
	};

	const azurePhaseOneVpc = {
		type: VpcType.AzureVpc,
		vpcName: "test-resource-rg-vnet-12345678",
		resourceGroupNameTruncated: "test-resource-rg",
		resourceGroupName:
			"/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg",
		cidrs: ["10.10.1.0/24", "10.10.2.0/24"],
		subnets: [
			{
				id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678/subnets/test-resource-rg-subnet-1",
				cidr: "10.10.1.0/24",
				type: "AzureSubnet",
			},
			{
				id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678/subnets/test-resource-rg-subnet-2",
				cidr: "10.10.2.0/24",
				type: "AzureSubnet",
			},
		],
		vpc: {
			id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678",
			tags: {
				"managed-by": "chasm",
			},
			type: "AzureVpc",
			region: "southcentralus",
			resourceGroupName:
				"/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg",
			subnets: [
				{
					id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678/subnets/test-resource-rg-subnet-1",
					cidr: "10.10.1.0/24",
					type: "AzureSubnet",
				},
				{
					id: "/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678/subnets/test-resource-rg-subnet-2",
					cidr: "10.10.2.0/24",
					type: "AzureSubnet",
				},
			],
		},
	};

	const azureVpcResources = //: AzurePhaseOneResource =
	{
		gatewaySubnet: pulumi.output({
			id: "subnet-1234-abcd-5678-90ef",
		}),
		publicIp: {
			id: pulumi.output("sg-22222222"),
			ipAddress: pulumi.output("10.0.2.2"),
		},
		vpnGateway: {
			id: pulumi.output("sg-87654321"),
			name: pulumi.output("vpn-gateway//subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678"),
			tags: pulumi.output({
				"managed-by": "chasm",
			}),
		},
	};

	const expectedPhaseOneAccounts = [
		{
			type: AccountType.AwsAccount,
			mockup: true,
			vpcs: {
				"vpc-12345678": awsPhaseOneVpc1,
				"vpc-87654321": awsPhaseOneVpc2,
			},
		},
		{
			type: AccountType.GcpAccount,
			mockup: true,
			vpcs: {
				"12345678901234567": gcpPhaseOneVpc,
			},
		},

		{
			type: AccountType.AzureAccount,
			mockup: true,
			vpcs: {
				"/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678":
					azurePhaseOneVpc,
			},
		},
	];

	beforeEach(() => {
		awsCounter = 0;
		forwardingCounter = 0;
	});

	it("buildPhase1Result builds expected PhaseOneAccount", () => {
		const result = buildPhase1Result(config, /* mockup = */ true);
		expect(result).toMatchObject(expectedPhaseOneAccounts);
	});

	const vpnGateway = new aws.ec2.VpnGateway(
		`vpn-gateway/abc123`,
		{
			vpcId: "id-something",
			tags: {
				"a": "aa",
				"b": "bb"
			},
		},
	);

	it("vpnGateway", () => {
		pulumi.all([vpnGateway.tags, vpnGateway.id]).apply(([tags, id]) => {
			expect(isPresent(tags?.a)).toBeTruthy();
			expect(isPresent(tags?.b)).toBeTruthy();
			expect(isPresent(tags?.c)).toBeFalsy();
			expect(id).toBe("sg-111111-1");
		});
	});

	it("resources from buildPhase1Result", () => {
		const result = buildPhase1Result(config, /* mockup = */ false);
		expect(result[0].type).toBe(AccountType.AwsAccount);
		expect(result[0].vpcs["vpc-12345678"].type).toBe(VpcType.AwsVpc);
		expect(result[0].vpcs["vpc-87654321"].type).toBe(VpcType.AwsVpc);
		// NOTE: Checking result[0].vpcs["vpc-12345678"].type allows us to know the type for
		// result[0].vpcs["vpc-12345678"].resource, but Typescript only enforces btw the two at compile-time in an if-clause,
		// not via expect() statements. We can't use if-clauses in this test because it violates the compile-time rule for no
		// conditional expects. Therefore, we use the "as AwsPhaseOneResource" to get the same type we KNOW we
		// would see for resource via an if-clause.
		const resource1 = outputOnOutsideAws(result[0].vpcs["vpc-12345678"].resource as AwsPhaseOneResource);
		const resource2 = outputOnOutsideAws(result[0].vpcs["vpc-87654321"].resource as AwsPhaseOneResource);
		pulumi.all([resource1, resource2]).apply(([resource1, resource2]) => {
			expect(resource1).toMatchObject(awsVpc1Resources);
			expect(resource2).toMatchObject(awsVpc2Resources);
		});

		expect(result[1].type).toBe(AccountType.GcpAccount);
		expect(result[1].vpcs["12345678901234567"].type).toBe(VpcType.GcpVpc);
		const resourceGcp = outputOnOutsideGcp(result[1].vpcs["12345678901234567"].resource as GcpPhaseOneResource);
		pulumi.all([resourceGcp]).apply(([resource]) => {
			expect(resource).toMatchObject(gcpVpcResources);
		});

		// pulumi.all([
		// 	gcpVpcResources.network, resourceGcp?.network,
		// ]).apply(([
		// 	expectedNetwork, actualNetwork
		// ]) => {
		// 	expect(actualNetwork).toMatchObject(expectedNetwork);
		// });

		// pulumi.all([
		// 	gcpVpcResources.vpnGateway.id, resourceGcp?.vpnGateway.id,
		// 	gcpVpcResources.vpnGateway.region, resourceGcp?.vpnGateway.region,
		// 	gcpVpcResources.vpnGateway.name, resourceGcp?.vpnGateway.name,
		// ]).apply(([
		// 	expectedVpnGatewayId,      actualVpnGatewayId,
		// 	expectedVpnGatewayRegion,  actualVpnGatewayRegion,
		// 	expectedVpnGatewayName,    actualVpnGatewayName,
		// ]) => {
		// 	expect(actualVpnGatewayId).toBe(expectedVpnGatewayId);
		// 	expect(actualVpnGatewayRegion).toBe(expectedVpnGatewayRegion);
		// 	expect(actualVpnGatewayName).toBe(expectedVpnGatewayName);
		// });

		// pulumi.all([
		// 	gcpVpcResources.publicIp.id, resourceGcp?.publicIp.id,
		// 	gcpVpcResources.publicIp.address, resourceGcp?.publicIp.address,
		// 	gcpVpcResources.publicIp.labels, resourceGcp?.publicIp.labels,
		// ]).apply(([
		// 	expectedPublicIpId,        actualPublicIpId,
		// 	expectedPublicIpAddress,   actualPublicIpAddress,
		// 	expectedPublicIpLabels,    actualPublicIpLabels,
		// ]) => {
		// 	expect(actualPublicIpId).toBe(expectedPublicIpId);
		// 	expect(actualPublicIpAddress).toBe(expectedPublicIpAddress);
		// 	expect(actualPublicIpLabels).toMatchObject(expectedPublicIpLabels);
		// });

		// pulumi.all([
		// 	gcpVpcResources.forwardingRules.esp.id, resourceGcp?.forwardingRules.esp.id,
		// 	gcpVpcResources.forwardingRules.esp.name, resourceGcp?.forwardingRules.esp.name,
		// 	gcpVpcResources.forwardingRules.esp.ipAddress, resourceGcp?.forwardingRules.esp.ipAddress,
		// 	gcpVpcResources.forwardingRules.esp.ipProtocol, resourceGcp?.forwardingRules.esp.ipProtocol,
		// 	gcpVpcResources.forwardingRules.esp.region, resourceGcp?.forwardingRules.esp.region,
		// 	gcpVpcResources.forwardingRules.esp.target, resourceGcp?.forwardingRules.esp.target,

		// 	gcpVpcResources.forwardingRules.ipsec.id, resourceGcp?.forwardingRules.ipsec.id,
		// 	gcpVpcResources.forwardingRules.ipsec.name, resourceGcp?.forwardingRules.ipsec.name,
		// 	gcpVpcResources.forwardingRules.ipsec.ipAddress, resourceGcp?.forwardingRules.ipsec.ipAddress,
		// 	gcpVpcResources.forwardingRules.ipsec.ipProtocol, resourceGcp?.forwardingRules.ipsec.ipProtocol,
		// 	gcpVpcResources.forwardingRules.ipsec.region, resourceGcp?.forwardingRules.ipsec.region,
		// 	gcpVpcResources.forwardingRules.ipsec.target, resourceGcp?.forwardingRules.ipsec.target,

		// 	gcpVpcResources.forwardingRules.ipsecNat.id, resourceGcp?.forwardingRules.ipsecNat.id,
		// 	gcpVpcResources.forwardingRules.ipsecNat.name, resourceGcp?.forwardingRules.ipsecNat.name,
		// 	gcpVpcResources.forwardingRules.ipsecNat.ipAddress, resourceGcp?.forwardingRules.ipsecNat.ipAddress,
		// 	gcpVpcResources.forwardingRules.ipsecNat.ipProtocol, resourceGcp?.forwardingRules.ipsecNat.ipProtocol,
		// 	gcpVpcResources.forwardingRules.ipsecNat.region, resourceGcp?.forwardingRules.ipsecNat.region,
		// 	gcpVpcResources.forwardingRules.ipsecNat.target, resourceGcp?.forwardingRules.ipsecNat.target,
		// ]).apply(([
		// 	expectedForwardingRulesEspId,              actualForwardingRulesEspId,
		// 	expectedForwardingRulesEspName,            actualForwardingRulesEspName,
		// 	expectedForwardingRulesEspIpAddress,       actualForwardingRulesEspIpAddress,
		// 	expectedForwardingRulesEspIpProtocol,      actualForwardingRulesEspIpProtocol,
		// 	expectedForwardingRulesEspRegion,          actualForwardingRulesEspRegion,
		// 	expectedForwardingRulesEspTarget,          actualForwardingRulesEspTarget,

		// 	expectedForwardingRulesIpSecId,            actualForwardingRulesIpSecId,
		// 	expectedForwardingRulesIpSecName,          actualForwardingRulesIpSecName,
		// 	expectedForwardingRulesIpSecIpAddress,     actualForwardingRulesIpSecIpAddress,
		// 	expectedForwardingRulesIpSecIpProtocol,    actualForwardingRulesIpSecIpProtocol,
		// 	expectedForwardingRulesIpSecRegion,        actualForwardingRulesIpSecRegion,
		// 	expectedForwardingRulesIpSecTarget,        actualForwardingRulesIpSecTarget,

		// 	expectedForwardingRulesIpSecNatId,         actualForwardingRulesIpSecNatId,
		// 	expectedForwardingRulesIpSecNatName,       actualForwardingRulesIpSecNatName,
		// 	expectedForwardingRulesIpSecNatIpAddress,  actualForwardingRulesIpSecNatIpAddress,
		// 	expectedForwardingRulesIpSecNatIpProtocol, actualForwardingRulesIpSecNatIpProtocol,
		// 	expectedForwardingRulesIpSecNatRegion,     actualForwardingRulesIpSecNatRegion,
		// 	expectedForwardingRulesIpSecNatTarget,     actualForwardingRulesIpSecNatTarget,
		// ]) => {
		// 	expect(actualForwardingRulesEspId).toBe(expectedForwardingRulesEspId);
		// 	expect(actualForwardingRulesEspName).toBe(expectedForwardingRulesEspName);
		// 	expect(actualForwardingRulesEspIpAddress).toBe(expectedForwardingRulesEspIpAddress);
		// 	expect(actualForwardingRulesEspIpProtocol).toBe(expectedForwardingRulesEspIpProtocol);
		// 	expect(actualForwardingRulesEspRegion).toBe(expectedForwardingRulesEspRegion);
		// 	expect(actualForwardingRulesEspTarget).toBe(expectedForwardingRulesEspTarget);

		// 	expect(actualForwardingRulesIpSecId).toBe(expectedForwardingRulesIpSecId);
		// 	expect(actualForwardingRulesIpSecName).toBe(expectedForwardingRulesIpSecName);
		// 	expect(actualForwardingRulesIpSecIpAddress).toBe(expectedForwardingRulesIpSecIpAddress);
		// 	expect(actualForwardingRulesIpSecIpProtocol).toBe(expectedForwardingRulesIpSecIpProtocol);
		// 	expect(actualForwardingRulesIpSecRegion).toBe(expectedForwardingRulesIpSecRegion);
		// 	expect(actualForwardingRulesIpSecTarget).toBe(expectedForwardingRulesIpSecTarget);

		// 	expect(actualForwardingRulesIpSecNatId).toBe(expectedForwardingRulesIpSecNatId);
		// 	expect(actualForwardingRulesIpSecNatName).toBe(expectedForwardingRulesIpSecNatName);
		// 	expect(actualForwardingRulesIpSecNatIpAddress).toBe(expectedForwardingRulesIpSecNatIpAddress);
		// 	expect(actualForwardingRulesIpSecNatIpProtocol).toBe(expectedForwardingRulesIpSecNatIpProtocol);
		// 	expect(actualForwardingRulesIpSecNatRegion).toBe(expectedForwardingRulesIpSecNatRegion);
		// 	expect(actualForwardingRulesIpSecNatTarget).toBe(expectedForwardingRulesIpSecNatTarget);
		// });

		expect(result[2].type).toBe(AccountType.AzureAccount);
		expect(result[2].vpcs["/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678"].type).toBe(VpcType.AzureVpc);
		const resourceAzure = result[2].vpcs["/subscriptions/12345678-9abc-def0-1234-56789abcdef0/resourceGroups/test-resource-rg/providers/Microsoft.Network/virtualNetworks/test-resource-rg-vnet-12345678"].resource as AzurePhaseOneResource;

		pulumi.all([
			azureVpcResources.gatewaySubnet, resourceAzure?.gatewaySubnet,
		]).apply(([
			expectedGatewaySubnet, actualGatewaySubnet
		]) => {
			expect(actualGatewaySubnet).toMatchObject(expectedGatewaySubnet);
		});

		pulumi.all([
			azureVpcResources.publicIp.id, resourceAzure?.publicIp.id,
			azureVpcResources.publicIp.ipAddress, resourceAzure?.publicIp.ipAddress,
		]).apply(([
			expectedPublicIpId,        actualPublicIpId,
			expectedPublicIpAddress,   actualPublicIpAddress,
		]) => {
			expect(actualPublicIpId).toBe(expectedPublicIpId);
			expect(actualPublicIpAddress).toBe(expectedPublicIpAddress);
		});

		pulumi.all([
			azureVpcResources.vpnGateway.id, resourceAzure?.vpnGateway.id,
			azureVpcResources.vpnGateway.name, resourceAzure?.vpnGateway.name,
			azureVpcResources.vpnGateway.tags, resourceAzure?.vpnGateway.tags,
		]).apply(([
			expectedVpnGatewayId,      actualVpnGatewayId,
			expectedVpnGatewayName,    actualVpnGatewayName,
			expectedVpnGatewayTags,    actualVpnGatewayTags,
		]) => {
			expect(actualVpnGatewayId).toBe(expectedVpnGatewayId);
			expect(actualVpnGatewayName).toBe(expectedVpnGatewayName);
			expect(actualVpnGatewayTags).toMatchObject(expectedVpnGatewayTags);
		});
	});
});
