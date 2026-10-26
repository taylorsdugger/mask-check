CREATE TABLE ratings (
  date TEXT NOT NULL,
  area TEXT NOT NULL,
  virus TEXT NOT NULL,
  threat TEXT NOT NULL,
  level TEXT,
  trend TEXT,
  forecast_change REAL,
  source TEXT NOT NULL,
  PRIMARY KEY (date, area, virus)
);
