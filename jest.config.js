// jest.config.js
export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {	'^(\\.{1,2}/.*)\\.js$': '$1.js'	},
	coverageDirectory: "./coverage",
	setupFiles: [
		"<rootDir>/tests/jest.setup.js"
	],
	verbose: true

};
