import os

# Tests never call the real Claude API, even when server/.env holds a key.
os.environ["LV_PLANNER"] = "rules"
