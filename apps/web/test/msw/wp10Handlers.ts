import { asIsoDate, daysBetween } from '@gmt/core';
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
