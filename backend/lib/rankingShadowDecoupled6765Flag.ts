import { evaluateFlagStage } from './featureStage.js';

export const RANKING_SHADOW_DECOUPLED_6765_FLAG = 'ranking_shadow_decoupled_6765';

type Client = { from?: (table: string) => unknown };
type Capture = (error: Error, context: { tags: Record<string, string> }) => void;

/** Fresh admission: configuration failures always retain the legacy path. */
export async function rankingShadowDecoupled6765Enabled(client: Client | null | undefined, captureExceptionFn?: Capture): Promise<boolean> {
  if (!client?.from) return false;
  try {
    const query = client.from('app_config') as {
      select: (columns: string) => { eq: (column: string, key: string) => {
        maybeSingle: () => PromiseLike<{ data: { value?: unknown } | null; error: { message: string } | null }>;
      } };
    };
    const { data, error } = await query.select('value').eq('key', RANKING_SHADOW_DECOUPLED_6765_FLAG).maybeSingle();
    if (error) throw new Error(error.message);
    const value = data?.value;
    return evaluateFlagStage(typeof value === 'string' || typeof value === 'boolean' ? value : null, { engineWrite: true });
  } catch (error) {
    captureExceptionFn?.(error instanceof Error ? error : new Error(String(error)), {
      tags: { lib: 'rankingShadowDecoupled6765Flag' },
    });
    return false;
  }
}
