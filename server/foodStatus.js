function calculateFoodStatus(weightRemaining, dailyUsage) {
    if (dailyUsage <= 0) {
        return {
            level: 'green',
            label: 'ปกติ',
            daysRemaining: Infinity,
            weightRemaining
        };
    }

    const daysRemaining = weightRemaining / dailyUsage;

    if (daysRemaining < 3) {
        return {
            level: 'red',
            label: 'เติมอาหาร',
            daysRemaining: Number(daysRemaining.toFixed(1)),
            weightRemaining
        };
    }

    if (daysRemaining <= 7) {
        return {
            level: 'yellow',
            label: 'เหลือน้อย',
            daysRemaining: Number(daysRemaining.toFixed(1)),
            weightRemaining
        };
    }

    return {
        level: 'green',
        label: 'ปกติ',
        daysRemaining: Number(daysRemaining.toFixed(1)),
        weightRemaining
    };
}

module.exports = {
    calculateFoodStatus
};