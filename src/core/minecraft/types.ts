// Minecraft version manifest types (from Mojang APIs)

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: VersionEntry[];
}

export interface VersionEntry {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}

export interface VersionMeta {
  id: string;
  type: string;
  mainClass: string;
  minecraftArguments?: string; // legacy
  arguments?: {
    game: Array<string | ConditionalArg>;
    jvm: Array<string | ConditionalArg>;
  };
  assetIndex: {
    id: string;
    sha1: string;
    size: number;
    totalSize: number;
    url: string;
  };
  assets: string;
  downloads: {
    client: DownloadInfo;
    client_mappings?: DownloadInfo;
    server?: DownloadInfo;
  };
  javaVersion?: {
    component: string;
    majorVersion: number;
  };
  libraries: Library[];
  logging?: {
    client?: {
      argument: string;
      file: { id: string; sha1: string; size: number; url: string };
      type: string;
    };
  };
  inheritsFrom?: string;
}

export interface ConditionalArg {
  rules: Rule[];
  value: string | string[];
}

export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}

export interface DownloadInfo {
  sha1: string;
  size: number;
  url: string;
}

export interface Library {
  name: string;
  downloads?: {
    artifact?: {
      path: string;
      sha1: string;
      size: number;
      url: string;
    };
    classifiers?: Record<
      string,
      {
        path: string;
        sha1: string;
        size: number;
        url: string;
      }
    >;
  };
  /** Maven repository root — loader profiles use this instead of `downloads` */
  url?: string;
  /** Integrity metadata published alongside Maven-style entries (Fabric/Quilt) */
  sha1?: string;
  size?: number;
  rules?: Rule[];
  natives?: Record<string, string>;
  extract?: { exclude: string[] };
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}
