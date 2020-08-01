import {
	CommandClasses,
	Maybe,
	validatePayload,
	ValueID,
	ValueMetadata,
	ZWaveError,
	ZWaveErrorCodes,
} from "@zwave-js/core";
import { pick } from "@zwave-js/shared";
import { clamp } from "alcalzone-shared/math";
import type { Driver } from "../driver/Driver";
import log from "../log";
import {
	CCAPI,
	SetValueImplementation,
	SET_VALUE,
	throwUnsupportedProperty,
	throwWrongValueType,
} from "./API";
import {
	API,
	CCCommand,
	CCCommandOptions,
	CCResponsePredicate,
	ccValue,
	ccValueMetadata,
	CommandClass,
	commandClass,
	CommandClassDeserializationOptions,
	expectedCCResponse,
	gotDeserializationOptions,
	implementedVersion,
} from "./CommandClass";

export function getVolumeValueId(endpointIndex: number | undefined): ValueID {
	return {
		commandClass: CommandClasses["Sound Switch"],
		endpoint: endpointIndex,
		property: "volume",
	};
}

export function getToneIdValueId(endpointIndex: number | undefined): ValueID {
	return {
		commandClass: CommandClasses["Sound Switch"],
		endpoint: endpointIndex,
		property: "toneId",
	};
}

// All the supported commands
export enum SoundSwitchCommand {
	TonesNumberGet = 0x01,
	TonesNumberReport = 0x02,
	ToneInfoGet = 0x03,
	ToneInfoReport = 0x04,
	ConfigurationSet = 0x05,
	ConfigurationGet = 0x06,
	ConfigurationReport = 0x07,
	TonePlaySet = 0x08,
	TonePlayGet = 0x09,
	TonePlayReport = 0x0a,
}

// @publicAPI
export enum ToneId {
	Off = 0x00,
	Default = 0xff,
}

@API(CommandClasses["Sound Switch"])
export class SoundSwitchCCAPI extends CCAPI {
	public supportsCommand(cmd: SoundSwitchCommand): Maybe<boolean> {
		switch (cmd) {
			case SoundSwitchCommand.TonesNumberGet:
			case SoundSwitchCommand.ToneInfoGet:
			case SoundSwitchCommand.ConfigurationSet:
			case SoundSwitchCommand.ConfigurationGet:
			case SoundSwitchCommand.TonePlaySet:
			case SoundSwitchCommand.TonePlayGet:
				return true; // This is mandatory
		}
		return super.supportsCommand(cmd);
	}

	public async getToneCount(): Promise<number> {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.TonesNumberGet,
		);

		const cc = new SoundSwitchCCTonesNumberGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<
			SoundSwitchCCTonesNumberReport
		>(cc))!;
		return response.toneCount;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public async getToneInfo(toneId: number) {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.ToneInfoGet,
		);

		const cc = new SoundSwitchCCToneInfoGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
			toneId,
		});
		const response = (await this.driver.sendCommand<
			SoundSwitchCCToneInfoReport
		>(cc))!;
		return pick(response, ["duration", "name"]);
	}

	public async setConfiguration(
		defaultToneId: number,
		defaultVolume: number,
	): Promise<void> {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.ConfigurationSet,
		);

		const cc = new SoundSwitchCCConfigurationSet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
			defaultToneId,
			defaultVolume,
		});
		await this.driver.sendCommand(cc);

		// Refresh the current value
		await this.getConfiguration();
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public async getConfiguration() {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.ConfigurationGet,
		);

		const cc = new SoundSwitchCCConfigurationGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<
			SoundSwitchCCConfigurationReport
		>(cc))!;
		return pick(response, ["defaultToneId", "defaultVolume"]);
	}

	public async play(toneId: number, volume?: number): Promise<void> {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.TonePlaySet,
		);

		if (toneId === 0) {
			throw new ZWaveError(
				`Tone ID must be > 0. Use stopPlaying to stop the tone.`,
				ZWaveErrorCodes.Argument_Invalid,
			);
		}

		const cc = new SoundSwitchCCTonePlaySet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
			toneId,
			volume,
		});
		await this.driver.sendCommand(cc);

		// Refresh the current value
		await this.getPlaying();
	}

	public async stopPlaying(): Promise<void> {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.TonePlaySet,
		);

		const cc = new SoundSwitchCCTonePlaySet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
			toneId: 0x00,
			volume: 0x00,
		});
		await this.driver.sendCommand(cc);

		// Refresh the current value
		await this.getPlaying();
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public async getPlaying() {
		this.assertSupportsCommand(
			SoundSwitchCommand,
			SoundSwitchCommand.TonePlayGet,
		);

		const cc = new SoundSwitchCCTonePlayGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<
			SoundSwitchCCTonePlayReport
		>(cc))!;
		return pick(response, ["toneId", "volume"]);
	}

	protected [SET_VALUE]: SetValueImplementation = async (
		{ property },
		value,
	): Promise<void> => {
		if (property === "defaultToneId") {
			if (typeof value !== "number") {
				throwWrongValueType(
					this.ccId,
					property,
					"number",
					typeof value,
				);
			}
			await this.setConfiguration(value, 0xff /* keep current volume */);
		} else if (property === "defaultVolume") {
			if (typeof value !== "number") {
				throwWrongValueType(
					this.ccId,
					property,
					"number",
					typeof value,
				);
			}
			await this.setConfiguration(0x00 /* keep current tone */, value);
		} else if (property === "toneId") {
			if (typeof value !== "number") {
				throwWrongValueType(
					this.ccId,
					property,
					"number",
					typeof value,
				);
			}
			if (value > 0) {
				// Try to use the current volume if it exists
				const volume = this.endpoint
					.getNodeUnsafe()
					?.getValue<number>(getVolumeValueId(this.endpoint.index));
				await this.play(value, volume);
			} else {
				await this.stopPlaying();
			}
		} else {
			throwUnsupportedProperty(this.ccId, property);
		}
	};
}

@commandClass(CommandClasses["Sound Switch"])
@implementedVersion(2)
export class SoundSwitchCC extends CommandClass {
	declare ccCommand: SoundSwitchCommand;

	public async interview(complete: boolean = true): Promise<void> {
		const node = this.getNode()!;
		const endpoint = this.getEndpoint()!;
		const api = endpoint.commandClasses["Sound Switch"];

		log.controller.logNode(node.id, {
			message: `${this.constructor.name}: doing a ${
				complete ? "complete" : "partial"
			} interview...`,
			direction: "none",
		});

		if (complete) {
			log.controller.logNode(node.id, {
				message: "requesting tone count...",
				direction: "outbound",
			});
			const toneCount = await api.getToneCount();
			const logMessage = `supports ${toneCount} tones`;
			log.controller.logNode(node.id, {
				message: logMessage,
				direction: "inbound",
			});

			const metadataStates: Record<number, string> = {
				0: "off",
			};
			for (let toneId = 1; toneId <= toneCount; toneId++) {
				log.controller.logNode(node.id, {
					message: `requesting info for tone #${toneId}`,
					direction: "outbound",
				});
				const info = await api.getToneInfo(toneId);
				const logMessage = `received info for tone #${toneId}:
name:     ${info.name}
duration: ${info.duration} seconds`;
				log.controller.logNode(node.id, {
					message: logMessage,
					direction: "inbound",
				});

				metadataStates[toneId] = `${info.name} (${info.duration} sec)`;
			}
			metadataStates[0xff] = "default";

			// Store tone count and info as a single metadata
			node.valueDB.setMetadata(getToneIdValueId(this.endpointIndex), {
				...ValueMetadata.Number,
				min: 0,
				max: toneCount,
				states: metadataStates,
				label: "Play Tone",
			});
		}

		log.controller.logNode(node.id, {
			message: "requesting current sound configuration...",
			direction: "outbound",
		});
		const config = await api.getConfiguration();
		const logMessage = `received current sound configuration:
default tone ID: ${config.defaultToneId}
default volume: ${config.defaultVolume}`;
		log.controller.logNode(node.id, {
			message: logMessage,
			direction: "inbound",
		});

		// Remember that the interview is complete
		this.interviewComplete = true;
	}
}

@CCCommand(SoundSwitchCommand.TonesNumberReport)
export class SoundSwitchCCTonesNumberReport extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);
		validatePayload(this.payload.length >= 1);
		this.toneCount = this.payload[0];
	}

	// @noCCValues We persist this as metadata during the interview

	public readonly toneCount: number;
}

@CCCommand(SoundSwitchCommand.TonesNumberGet)
@expectedCCResponse(SoundSwitchCCTonesNumberReport)
export class SoundSwitchCCTonesNumberGet extends SoundSwitchCC {}

@CCCommand(SoundSwitchCommand.ToneInfoReport)
export class SoundSwitchCCToneInfoReport extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);
		validatePayload(this.payload.length >= 4);
		this.toneId = this.payload[0];
		this.duration = this.payload.readUInt16BE(1);
		const nameLength = this.payload[3];
		validatePayload(this.payload.length >= 4 + nameLength);
		this.name = this.payload.slice(4, 4 + nameLength).toString("utf8");
	}

	// @noCCValues These values are manually persisted during the interview

	public readonly toneId: number;
	public readonly duration: number;
	public readonly name: string;
}

const testResponseForSoundSwitchToneInfoGet: CCResponsePredicate = (
	sent: SoundSwitchCCToneInfoGet,
	received,
	isPositiveTransmitReport,
) => {
	return received instanceof SoundSwitchCCToneInfoReport &&
		received.toneId === sent.toneId
		? "final"
		: isPositiveTransmitReport
		? "confirmation"
		: "unexpected";
};

interface SoundSwitchCCToneInfoGetOptions extends CCCommandOptions {
	toneId: number;
}

@CCCommand(SoundSwitchCommand.ToneInfoGet)
@expectedCCResponse(testResponseForSoundSwitchToneInfoGet)
export class SoundSwitchCCToneInfoGet extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options:
			| CommandClassDeserializationOptions
			| SoundSwitchCCToneInfoGetOptions,
	) {
		super(driver, options);
		if (gotDeserializationOptions(options)) {
			// TODO: Deserialize payload
			throw new ZWaveError(
				`${this.constructor.name}: deserialization not implemented`,
				ZWaveErrorCodes.Deserialization_NotImplemented,
			);
		} else {
			this.toneId = options.toneId;
		}
	}

	public toneId: number;

	public serialize(): Buffer {
		this.payload = Buffer.from([this.toneId]);
		return super.serialize();
	}
}

interface SoundSwitchCCConfigurationSetOptions extends CCCommandOptions {
	defaultVolume: number;
	defaultToneId: number;
}

@CCCommand(SoundSwitchCommand.ConfigurationSet)
export class SoundSwitchCCConfigurationSet extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options:
			| CommandClassDeserializationOptions
			| SoundSwitchCCConfigurationSetOptions,
	) {
		super(driver, options);
		if (gotDeserializationOptions(options)) {
			// TODO: Deserialize payload
			throw new ZWaveError(
				`${this.constructor.name}: deserialization not implemented`,
				ZWaveErrorCodes.Deserialization_NotImplemented,
			);
		} else {
			this.defaultVolume = options.defaultVolume;
			this.defaultToneId = options.defaultToneId;
		}
	}

	public defaultVolume: number;
	public defaultToneId: number;

	public serialize(): Buffer {
		this.payload = Buffer.from([this.defaultVolume, this.defaultToneId]);
		return super.serialize();
	}
}

@CCCommand(SoundSwitchCommand.ConfigurationReport)
export class SoundSwitchCCConfigurationReport extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);
		validatePayload(this.payload.length >= 2);
		this.defaultVolume = clamp(this.payload[0], 0, 100);
		this.defaultToneId = this.payload[1];

		this.persistValues();
	}

	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.Number,
		min: 0,
		max: 100,
		unit: "%",
		label: "Default volume",
	})
	public readonly defaultVolume: number;

	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.Number,
		min: 0,
		max: 254,
		label: "Default tone ID",
	})
	public readonly defaultToneId: number;
}

@CCCommand(SoundSwitchCommand.ConfigurationGet)
@expectedCCResponse(SoundSwitchCCConfigurationReport)
export class SoundSwitchCCConfigurationGet extends SoundSwitchCC {}

interface SoundSwitchCCTonePlaySetOptions extends CCCommandOptions {
	toneId: ToneId | number;
	// V2+
	volume?: number;
}

@CCCommand(SoundSwitchCommand.TonePlaySet)
export class SoundSwitchCCTonePlaySet extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options:
			| CommandClassDeserializationOptions
			| SoundSwitchCCTonePlaySetOptions,
	) {
		super(driver, options);
		if (gotDeserializationOptions(options)) {
			// TODO: Deserialize payload
			throw new ZWaveError(
				`${this.constructor.name}: deserialization not implemented`,
				ZWaveErrorCodes.Deserialization_NotImplemented,
			);
		} else {
			this.toneId = options.toneId;
			this.volume = options.volume;
		}
	}

	public toneId: ToneId | number;
	public volume?: number;

	public serialize(): Buffer {
		this.payload = Buffer.from([this.toneId]);
		if (this.version >= 2 && this.volume != undefined) {
			this.payload = Buffer.concat([
				this.payload,
				Buffer.from([this.volume]),
			]);
		}
		return super.serialize();
	}
}

@CCCommand(SoundSwitchCommand.TonePlayReport)
export class SoundSwitchCCTonePlayReport extends SoundSwitchCC {
	public constructor(
		driver: Driver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);
		validatePayload(this.payload.length >= 1);
		this.toneId = this.payload[0];

		this.persistValues();
	}

	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.UInt8,
		label: "Tone ID",
	})
	public readonly toneId: ToneId | number;

	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.UInt8,
		min: 0,
		max: 100,
		unit: "%",
		label: "Volume",
		states: {
			0: "default",
		},
	})
	public volume?: number;
}

@CCCommand(SoundSwitchCommand.TonePlayGet)
@expectedCCResponse(SoundSwitchCCTonePlayReport)
export class SoundSwitchCCTonePlayGet extends SoundSwitchCC {}