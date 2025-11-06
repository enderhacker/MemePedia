const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize({
	dialect: "sqlite",
	storage: "./database.sqlite",
	logging: false,
});

const Visits = sequelize.define("Visits", {
	count: {
		type: DataTypes.INTEGER,
		defaultValue: 0,
	},
});

(async () => {
	await sequelize.sync();
})();

module.exports = { sequelize, Visits };
