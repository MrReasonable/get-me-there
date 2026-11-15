import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse } from '../../api/types.js';

/**
 * Ruling 8's fix, for a finished search that found nothing while the browser is configured and off for it: the
 * `prepare` step of the card's one Search again button (its label then reads "Turn on the browser for this search and
 * search again"). It saves the search with `camoufox` added to its discovery (its other sources kept); the button then
 * starts it with the ordinary start, only when this save succeeded. A failure is that button's to say, and nothing starts.
 * It is a step of the same button, never a component of its own: the cards re-read once the save lands, and a button
 * swapped for another at that point would lose the start's refusal.
 */
export function useTurnOnBrowser(): (definition: DefinitionResponse) => Promise<void> {
  const qc = useQueryClient();
  return async (definition) => {
    if (definition.providers.discovery.includes('camoufox')) return;
    await api.updateDefinition(definition.id, {
      providers: {
        ...definition.providers,
        discovery: [...definition.providers.discovery, 'camoufox'],
      },
    });
    void Promise.all([['definitions'], ['cards']].map((queryKey) => qc.invalidateQueries({ queryKey })));
  };
}
