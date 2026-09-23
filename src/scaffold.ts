// Starter files written by `easyql init`. Kept in sync with the repo's own
// schema.json / seed.json examples.
export const SCHEMA_TEMPLATE = `{
  "users": {
    "columns": [
      { "c_name": "id", "c_type": "text", "is_primary_key": true },
      { "c_name": "name", "c_type": "text", "is_nullable": false }
    ]
  },
  "posts": {
    "columns": [
      { "c_name": "id", "c_type": "text", "is_primary_key": true },
      { "c_name": "user_id", "c_type": "text", "is_nullable": false }
    ],
    "relations": [
      {
        "type": "many_to_one",
        "column": "user_id",
        "references": { "table": "users", "column": "id" },
        "on_delete": "cascade"
      }
    ]
  }
}
`;

export const SEED_TEMPLATE = `{
  "users": [{ "id": "u1", "name": "Ada" }],
  "posts": [{ "id": "p1", "user_id": "u1" }]
}
`;
