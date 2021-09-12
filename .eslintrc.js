module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    parserOptions: {
        project: "./**/tsconfig.json"
    },
    plugins: [
        "@typescript-eslint"
    ],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking"
    ],
    rules: {
        "@typescript-eslint/promise-function-async": "error",
        "@typescript-eslint/array-type": "error",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-misused-promises": [
            "error",
            {
                "checksVoidReturn": false
            }
        ],
        "@typescript-eslint/unbound-method": [
            "error",
            {
                "ignoreStatic": true
            }
        ]
    }
};