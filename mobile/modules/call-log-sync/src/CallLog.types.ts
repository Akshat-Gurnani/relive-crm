export type DeviceCall = {
  id: string;
  number: string;
  type: 'incoming' | 'outgoing' | 'missed' | 'rejected' | 'blocked' | 'other';
  date: number; // epoch ms
  duration: number; // seconds
  name: string | null;
};
