import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Crumbs, searchCrumb, tripsCrumb } from '../../src/components/Crumbs.js';
import { COPY } from '../../src/copy.js';
import { renderWithProviders } from '../render.js';

// Design 2026-11-08 Ruling 12: one breadcrumb component, lifted from the Trip page.

describe('Crumbs', () => {
  it('is a nav named "Breadcrumb" holding an ordered list, with decorative separators', () => {
    renderWithProviders(
      <Crumbs
        items={[
          { label: 'Trips', href: '/?view=searches' },
          { label: 'Worked example', href: '/?view=dates&def=d' },
          { label: 'Edit' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const list = within(nav).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Trips › ', 'Worked example › ', 'Edit']);
    // the separators are for the eye only
    expect([...nav.querySelectorAll('[aria-hidden="true"]')].map((s) => s.textContent)).toEqual([
      ' › ',
      ' › ',
    ]);
    expect(nav).toHaveTextContent('Trips › Worked example › Edit');
  });

  it('the last item is the page: aria-current, never a link, even with an href', () => {
    renderWithProviders(
      <Crumbs
        items={[
          { label: 'Trips', href: '/?view=searches' },
          { label: 'Here', href: '/?x=1' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Trips']);
    expect(within(nav).getByText('Here')).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('a middle item without an href is plain text, and a lone item is only the page', () => {
    const first = renderWithProviders(<Crumbs items={[{ label: 'A' }, { label: 'B' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('A')).not.toHaveAttribute('aria-current');
    first.unmount();
    renderWithProviders(<Crumbs items={[{ label: 'Only' }]} />);
    expect(screen.getByText('Only')).toHaveAttribute('aria-current', 'page');
  });

  it('a link navigates in place to exactly its address', async () => {
    const { user } = renderWithProviders(
      <Crumbs
        items={[{ label: 'Trips', href: '/?view=searches&d.to=JFK', testId: 'back' }, { label: 'Here' }]}
      />,
      { search: '?view=dates&def=def-0001&d.from=LHR&d.to=JFK' },
    );
    const link = screen.getByTestId('back');
    expect(link).toHaveAttribute('href', '/?view=searches&d.to=JFK');
    await user.click(link);
    expect(window.location.search).toBe('?view=searches&d.to=JFK');
  });
});

describe('the shared steps', () => {
  it('Trips names no search and keeps the other parameters (the filters travel back)', () => {
    renderWithProviders(<Crumbs items={[tripsCrumb(), { label: 'x' }]} />, {
      search: '?view=dates&def=def-0001&d.to=JFK&edit=def-0001',
    });
    const href = screen.getByRole('link', { name: COPY.crumbs.trips }).getAttribute('href') ?? '';
    const params = new URL(href, 'http://x').searchParams;
    expect(params.get('view')).toBe('searches');
    expect(params.has('def')).toBe(false);
    expect(params.has('edit')).toBe(false);
    expect(params.get('d.to')).toBe('JFK');
  });

  it('a search’s name links to its page', () => {
    renderWithProviders(
      <Crumbs items={[searchCrumb({ id: 'def-0001', name: 'Worked example' }), { label: 'x' }]} />,
      {
        search: '?view=definitions&edit=def-0001',
      },
    );
    const href = screen.getByRole('link', { name: 'Worked example' }).getAttribute('href') ?? '';
    const params = new URL(href, 'http://x').searchParams;
    expect(params.get('view')).toBe('dates');
    expect(params.get('def')).toBe('def-0001');
    expect(params.has('edit')).toBe(false);
  });
});
