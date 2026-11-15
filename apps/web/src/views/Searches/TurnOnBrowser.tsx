import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { SearchAgainButton } from '../Dates/SearchAgainButton.js';

/**
 * Ruling 8's fix, for a finished search that found nothing while the browser is configured and off for it: "Turn on the
 * browser for this search and search again". One press saves the search with `camoufox` added to its discovery (its other
 * sources kept) and, only when that save succeeded, starts it with the ordinary Search again (its confirmation steps,
 * refusals and "Searching…" are that button's). A failed save says so beside the button and starts nothing.
 */
export function TurnOnBrowser({ definitionId, name }: { definitionId: string; name: string }) {
  const qc = useQueryClient();
  const turnOn = async (definition: DefinitionResponse) => {
    if (definition.providers.discovery.includes('camoufox')) return;
    await api.updateDefinition(definition.id, {
      providers: {
        ...definition.providers,
        discovery: [...definition.providers.discovery, 'camoufox'],
      },
    });
    // why: not awaited: the re-read would drop this button (the browser is then on) before the start below is sent
    void Promise.all([['definitions'], ['cards']].map((queryKey) => qc.invalidateQueries({ queryKey })));
  };
  return (
    <SearchAgainButton
      definitionId={definitionId}
      label={COPY.searchesView.turnOnBrowser}
      accessibleName={COPY.searchesView.turnOnBrowserOf(name)}
      prepare={turnOn}
    />
  );
}
