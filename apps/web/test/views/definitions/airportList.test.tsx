import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { AirportListInput } from '../../../src/views/Definitions/AirportListInput.js';
import { API, airports } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

function Harness({ initial = [] }: { initial?: string[] }) {
  const [codes, setCodes] = useState<string[]>(initial);
  return (
    <AirportListInput
      id="origins"
      label="Origins"
      addLabel="Add origin"
      codes={codes}
      onChange={setCodes}
      errors={[]}
    />
  );
}
const chipCodes = () =>
  within(within(screen.getByRole('group', { name: 'Origins' })).getByRole('list'))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);

describe('airport list input (spec §11)', () => {
  it('a code added while an earlier lookup is pending does not drop it, nor does the earlier one drop it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/airports`, async ({ request }) => {
        // why: the first typed code's lookup is held while the second is typed and answered
        if (new URL(request.url).searchParams.get('q') === 'LHR') await gate;
        return HttpResponse.json(airports);
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    await user.type(screen.getByLabelText('Origins'), 'LHR{Enter}');
    // why: the box still holds the pending code until its lookup answers, so the operator clears it and types the next
    await user.clear(screen.getByLabelText('Origins'));
    await user.type(screen.getByLabelText('Origins'), 'JFK{Enter}');
    await waitFor(() => expect(chipCodes()).toEqual(['JFK']));
    release();
    await waitFor(() => expect(chipCodes()).toEqual(['JFK', 'LHR']));
  });

  it('a metro code whose airports are all in the list adds nothing and does not claim it expanded', async () => {
    const { user } = renderWithProviders(<Harness initial={['LHR', 'LGW']} />);
    await user.type(screen.getByLabelText('Origins'), 'LON{Enter}');
    expect(await screen.findByText(COPY.duplicateAirport('LHR, LGW'))).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(chipCodes()).toEqual(['LHR', 'LGW']);
  });
});
