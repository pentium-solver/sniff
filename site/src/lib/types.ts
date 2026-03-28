export interface Flow {
  ts: number;
  method: string;
  url: string;
  host: string;
  path: string;
  status: number;
  req_size: number;
  resp_size: number;
  content_type: string;
  req_headers: Record<string, string>;
  resp_headers: Record<string, string>;
  req_body: string | null;
  resp_body: string | null;
  _index?: number;
}

export interface LogEntry {
  Time: string;
  Msg: string;
  Style: string;
}

export interface SettingsField {
  key: string;
  label: string;
  value: string;
}

export interface AppItem {
  Name: string;
  ID: string;
  PID: number;
}

export interface FridaScript {
  ID: string;
  Name: string;
  Label: string;
  Desc: string;
}

export interface DeviceInfo {
  Model: string;
  Android: string;
  SDK: string;
  SELinux: string;
  FridaRunning: boolean;
  Proxy: string;
  HostIP: string;
  Connected: boolean;
}
