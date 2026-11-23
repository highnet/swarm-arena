-- No finish line: the goal is open-ended. Past the top rung, versions are rated against themselves.
alter table tracks drop column finish_label;
alter table tracks drop column finish_elo;
