-- `arena versus` streams its games to live_games too (#163), but it plays outside any referee
-- match: it has no `matches` row to point at. Its rows carry a null match_id; referee rows keep
-- theirs (and the cascade that deletes them with their match).
alter table live_games alter column match_id drop not null;
