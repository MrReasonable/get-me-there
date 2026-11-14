-- why: The booking page's address (design §6.3): a flight list's booking read stores the address of the booking page it
-- reached in a column of its own, NULL on every existing row and on a list read without one. Additive only: one ADD
-- COLUMN, no row is copied; no CHECK, as one would make drizzle-kit rebuild the table (the insert holds the path rule, a
-- read takes any string). The statement is drizzle-kit's own.
ALTER TABLE `flight_lists` ADD `booking_url` text;
