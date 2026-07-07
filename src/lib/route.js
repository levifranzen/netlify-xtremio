function parsePath(path) {
  const stripped = path.replace(/^\/.netlify\/functions\/addon\/?/, "");
  const parts = stripped.split("/");
  return {
    token: parts[0] || null,
    resource: (parts[1] || "").replace(/\.json$/, ""),
  };
}

module.exports = { parsePath };
