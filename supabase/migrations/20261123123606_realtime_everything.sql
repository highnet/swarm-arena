-- Everything the site shows streams over Supabase Realtime: tasks (claims, reviews, landings),
-- games (each game of a gate match as it finishes) and runs (a new run starting) join the tables
-- already published. Payloads still pass RLS: the public read policies are what anon receives.
alter publication supabase_realtime add table tasks, games, runs;
