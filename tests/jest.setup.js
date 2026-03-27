// jest.setup.js
if (process.env.NODE_OPTIONS?.includes('debug')) {
	console.log('\n\n! DEBUG MODE !\n\n');
	process.env.NODE_ENV = 'dev';
}

else {
	console.log('\n! RUN MODE !\n');
}
