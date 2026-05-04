const { Compilation, sources } = require("webpack");

class EmitNewTabPagePlugin {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap("EmitNewTabPagePlugin", compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: "EmitNewTabPagePlugin",
                    stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
                },
                () => {
                    compilation.emitAsset(
                        "newtab/newtab.html",
                        new sources.RawSource(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tabby New Tab</title>
</head>
<body>
    <div id="app"></div>
    <script src="newtab.js"></script>
</body>
</html>`)
                    );
                }
            );
        });
    }
}

module.exports = {
    EmitNewTabPagePlugin
};