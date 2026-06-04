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
  _id?: string; // client-side UUID stamped on arrival, used as annotation key
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
  IsEmulator?: boolean;
}

export interface CapturedFingerprint {
  id: string;
  ts: number;
  package: string;
  sni: string;
  dst_ip: string;
  dst_port: string;
  tls_version: string;
  ja3: string;
  ja4: string;
  cipher_count: number;
  ext_count: number;
  utls_spec: string;
}
