import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { DeviceCall } from './CallLog.types';

declare class CallLogSyncModule extends NativeModule<{}> {
  isSupported(): boolean;
  readCalls(sinceMs: number, limit: number): Promise<DeviceCall[]>;
  findRecording(startedMs: number, durationSec: number, number: string): Promise<string | null>;
  readAsBase64(uri: string, maxBytes: number): Promise<string | null>;
}

// Null on iPhone, in Expo Go, and on the web: only the Android app build carries this module.
export default requireOptionalNativeModule<CallLogSyncModule>('CallLogSync');
