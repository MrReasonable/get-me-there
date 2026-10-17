import { HttpResponse, http } from 'msw';
import { API } from '../fixtures.js';
import {
  cellAt,
  cellDetail,
  defaultCalendar,
  durationResponse,
  itineraryHistory,
  night,
  routeHistory,
} from '../fixtures.wp10.js';

/**
 * Default responses for WP10's five routes, so every view renders real content under WP9's unhandled-request-error
 * server (WP9's rendered-copy sweep visits Calendar, Duration and History too). Tests override them with server.use.
 */
export const wp10Handlers = [
  http.get(`${API}/definitions/:id/calendar`, () => HttpResponse.json(defaultCalendar())),
  http.get(`${API}/definitions/:id/duration-analysis`, () =>
    HttpResponse.json(
      durationResponse([
        night(10, [52000, 3], [41200, 5]),
        night(11, null, [39900, 4]),
        night(12, null, null),
      ]),
    ),
  ),
  http.get(`${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`, () =>
    HttpResponse.json(cellDetail(cellAt('2027-03-14', 14))),
  ),
  http.get(`${API}/routes/:origin/:destination/history`, () => HttpResponse.json(routeHistory())),
  http.get(`${API}/itineraries/:hash/history`, () => HttpResponse.json(itineraryHistory())),
];
