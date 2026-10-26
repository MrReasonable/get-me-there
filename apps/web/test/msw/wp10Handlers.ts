import { asIsoDate, daysBetween } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import { API } from '../fixtures.js';
import { cellAt, cellDetail, itineraryHistory, routeHistory } from '../fixtures.wp10.js';

/**
 * Default responses for the WP10 routes that outlive WP19 (the cell route behind the date pair detail's airport-pair
 * panels, and History's two), so every view renders real content under WP9's unhandled-request-error server. Tests
 * override them with server.use. The calendar and duration-analysis routes are retired (spec §10, revision 48).
 */
export const wp10Handlers = [
  // why: the detail is for the cell the URL names, so a view that asks for the wrong cell shows the wrong detail
  http.get(`${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`, ({ params }) => {
    const departure = asIsoDate(String(params.departureDate));
    const nights = daysBetween(departure, asIsoDate(String(params.returnDate)));
    return HttpResponse.json(
      cellDetail(cellAt(departure, nights, String(params.origin), String(params.destination))),
    );
  }),
  http.get(`${API}/routes/:origin/:destination/history`, () => HttpResponse.json(routeHistory())),
  http.get(`${API}/itineraries/:hash/history`, () => HttpResponse.json(itineraryHistory())),
];
