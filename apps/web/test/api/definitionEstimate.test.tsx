import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDefinitionEstimate } from '../../src/api/queries.js';
import { definitionToDraft, draftToRequest } from '../../src/views/Definitions/draft.js';
import { API, definition, estimateResponse } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

// WP20 Task 20.5 follow-up 3: a saved search's estimate is shown only once it is current. A remount re-reads it, and
// the cached answer of the earlier read is never shown meanwhile, as `useEstimateDraft` rules (fix round 1, finding 8).

const BODY = draftToRequest(definitionToDraft(definition()));

function Probe() {
  const q = useDefinitionEstimate('def-0001', BODY, true);
  return <p data-testid="probe">{q.data === undefined ? 'none' : String(q.data.datePairs)}</p>;
}

/** Shows the probe until "hide" is pressed, and again on "show": a remount in the same query client. */
function Host() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown(!shown)}>
        toggle
      </button>
      {shown ? <Probe /> : null}
    </>
  );
}

describe('useDefinitionEstimate', () => {
  it('a remount shows no cached older answer while the estimate is read again', async () => {
    const answers = [126, 300];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // why: the second read's arrival is an event the test awaits, never a poll
    let arrived: () => void = () => undefined;
    const reread = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    server.use(
      http.post(`${API}/definitions/:id/estimate`, async () => {
        const datePairs = answers.shift() ?? 0;
        if (datePairs === 300) {
          arrived();
          await gate;
        }
        return HttpResponse.json(estimateResponse({ datePairs, datePairsCovered: datePairs }));
      }),
    );
    const { user } = renderWithProviders(<Host />);
    expect(await screen.findByText('126')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    // the second read is held: the first answer is cached but not current
    await reread;
    expect(screen.getByTestId('probe')).toHaveTextContent('none');
    release();
    expect(await screen.findByText('300')).toBeInTheDocument();
  });
});
