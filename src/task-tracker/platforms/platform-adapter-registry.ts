import { ApiError } from "../errors/api-error.ts";
import type { PlatformAdapter } from "./platform-adapter.ts";
import { type Platform } from "../domain/platform.ts";

export class PlatformAdapterRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>();

  constructor(adapters: PlatformAdapter[]) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform))
      throw new Error(
        `Platform adapter already registered: ${adapter.platform}`,
      );
    this.adapters.set(adapter.platform, adapter);
  }

  get(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform as Platform);
    if (!adapter)
      throw new ApiError(
        400,
        "PLATFORM_NOT_SUPPORTED",
        "The requested platform is not registered.",
      );
    return adapter;
  }
}
