import  Task from '../models/Task.js';
import User from '../models/User.js'
import Association from '../models/Association.js'
import moment from 'moment';
import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs';

// משימות פתוחות לפי עובד.
export const openTasksByEmployee = async (req, res) => {
        const { startDate, endDate, format = 'json' } = req.query;
        
        const matchStage = {
            status: { $nin: ['הושלם', 'בוטלה'] },
            isDeleted: { $ne: true }
        };
        
        if (startDate && endDate) {
            matchStage.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const pipeline = [
            { $match: matchStage },
            {
                $lookup: {
                    from: 'users',
                    localField: 'mainAssignee',
                    foreignField: '_id',
                    as: 'mainAssigneeDetails'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'assignees',
                    foreignField: '_id',
                    as: 'assigneesDetails'
                }
            },
            {
                $lookup: {
                    from: 'associations',
                    localField: 'organization',
                    foreignField: '_id',
                    as: 'organizationDetails'
                }
            },
            {
                $group: {
                    _id: '$mainAssignee',
                    employeeName: { $first: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] } },
                    totalTasks: { $sum: 1 },
                    urgentTasks: {
                        $sum: { $cond: [{ $eq: ['$importance', 'מיידי'] }, 1, 0] }
                    },
                    drawerTasks: {
                        $sum: { $cond: [{ $eq: ['$importance', 'מגירה'] }, 1, 0] }
                    },
                    overdueTasks: {
                        $sum: {
                            $cond: [
                                { $lt: ['$dueDate', new Date()] },
                                1, 0
                            ]
                        }
                    },
                    tasks: {
                        $push: {
                            taskId: '$taskId',
                            title: '$title',
                            status: '$status',
                            importance: '$importance',
                            dueDate: '$dueDate',
                            organization: { $arrayElemAt: ['$organizationDetails.name', 0] },
                            daysOpen: {
                                $floor: {
                                    $divide: [
                                        { $subtract: [new Date(), '$createdAt'] },
                                        1000 * 60 * 60 * 24
                                    ]
                                }
                            }
                        }
                    }
                }
            },
            { $sort: { totalTasks: -1 } }
        ];

        const results = await Task.aggregate(pipeline);

        if (format === 'pdf') {
            return generatePDFReport(res, results, 'דוח משימות פתוחות לפי עובד');
        } else if (format === 'excel') {
            return generateExcelReport(res, results, 'משימות פתוחות לפי עובד');
        }

        res.json({
            success: true,
            data: results,
            generatedAt: new Date(),
            totalEmployees: results.length,
            summary: {
                totalOpenTasks: results.reduce((sum, emp) => sum + emp.totalTasks, 0),
                totalUrgentTasks: results.reduce((sum, emp) => sum + emp.urgentTasks, 0),
                totalOverdueTasks: results.reduce((sum, emp) => sum + emp.overdueTasks, 0)
            }
        });
}

//דוח משימות חורגות מיעד
export const overdueTasks = async (req, res) => {
        const { days = 7, format = 'json' } = req.query;
        const cutoffDate = moment().subtract(days, 'days').toDate();

        const pipeline = [
            {
                $match: {
                    dueDate: { $lt: new Date() },
                    status: { $nin: ['הושלם', 'בוטלה'] },
                    isDeleted: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'mainAssignee',
                    foreignField: '_id',
                    as: 'mainAssigneeDetails'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'creator',
                    foreignField: '_id',
                    as: 'creatorDetails'
                }
            },
            {
                $lookup: {
                    from: 'associations',
                    localField: 'organization',
                    foreignField: '_id',
                    as: 'organizationDetails'
                }
            },
            {
                $addFields: {
                    daysOverdue: {
                        $floor: {
                            $divide: [
                                { $subtract: [new Date(), '$dueDate'] },
                                1000 * 60 * 60 * 24
                            ]
                        }
                    },
                    mainAssigneeName: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] },
                    creatorName: { $arrayElemAt: ['$creatorDetails.userName', 0] },
                    organizationName: { $arrayElemAt: ['$organizationDetails.name', 0] }
                }
            },
            { $sort: { daysOverdue: -1 } }
        ];

        const results = await Task.aggregate(pipeline);

        if (format === 'pdf') {
            return generatePDFReport(res, results, 'דוח משימות חורגות מיעד');
        } else if (format === 'excel') {
            return generateExcelReport(res, results, 'משימות שמועד השלמתן עבר');
        }

        res.json({
            success: true,
            data: results,
            generatedAt: new Date(),
            totalOverdueTasks: results.length,
            summary: {
                criticalOverdue: results.filter(task => task.daysOverdue > 30).length,
                moderateOverdue: results.filter(task => task.daysOverdue > 7 && task.daysOverdue <= 30).length,
                recentOverdue: results.filter(task => task.daysOverdue <= 7).length
            }
        });
}

//  סיכום משימות לפי שבוע/חודש
export const taskSummary = async (req, res) => {
        const { period = 'month', startDate, endDate, format = 'json' } = req.query;
        
        let matchStage = { isDeleted: { $ne: true } };
        
        if (startDate && endDate) {
            matchStage.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        } else {
            // ברירת מחדל - חודש אחרון
            matchStage.createdAt = {
                $gte: moment().subtract(1, period).toDate(),
                $lte: new Date()
            };
        }

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        period: period === 'week' 
                            ? { $week: '$createdAt' }
                            : { $month: '$createdAt' },
                        status: '$status',
                        importance: '$importance'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: {
                        year: '$_id.year',
                        period: '$_id.period'
                    },
                    stats: {
                        $push: {
                            status: '$_id.status',
                            importance: '$_id.importance',
                            count: '$count'
                        }
                    },
                    totalTasks: { $sum: '$count' }
                }
            },
            { $sort: { '_id.year': 1, '_id.period': 1 } }
        ];

        const results = await Task.aggregate(pipeline);

        // עיבוד הנתונים לפורמט נוח יותר
        const processedResults = results.map(item => {
            const stats = {
                completed: 0,
                inProgress: 0,
                cancelled: 0,
                urgent: 0,
                drawer: 0,
                general: 0
            };

            item.stats.forEach(stat => {
                switch (stat.status) {
                    case 'הושלם': stats.completed += stat.count; break;
                    case 'בתהליך': stats.inProgress += stat.count; break;
                    case 'בוטלה': stats.cancelled += stat.count; break;
                }
                
                switch (stat.importance) {
                    case 'מיידי': stats.urgent += stat.count; break;
                    case 'מגירה': stats.drawer += stat.count; break;
                    case 'כללי': stats.general += stat.count; break;
                }
            });

            return {
                period: `${item._id.year}-${item._id.period}`,
                totalTasks: item.totalTasks,
                completionRate: ((stats.completed / item.totalTasks) * 100).toFixed(1),
                ...stats
            };
        });

        if (format === 'pdf') {
            return generatePDFReport(res, processedResults, `סיכום משימות לפי ${period === 'week' ? 'שבוע' : 'חודש'}`);
        } else if (format === 'excel') {
            return generateExcelReport(res, processedResults, 'סיכום משימות');
        }

        res.json({
            success: true,
            data: processedResults,
            generatedAt: new Date(),
            period: period,
            summary: {
                totalPeriods: processedResults.length,
                avgTasksPerPeriod: (processedResults.reduce((sum, p) => sum + p.totalTasks, 0) / processedResults.length).toFixed(1),
                avgCompletionRate: (processedResults.reduce((sum, p) => sum + parseFloat(p.completionRate), 0) / processedResults.length).toFixed(1)
            }
        });
}

//  סטטיסטיקה אישית לכל עובד
export const employeeStatistics = async (req, res) => {
    
        const { employeeId, startDate, endDate, format = 'json' } = req.query;
        
        let matchStage = { isDeleted: { $ne: true } };
        
        if (employeeId) {
            matchStage.$or = [
                { mainAssignee: employeeId },
                { assignees: employeeId }
            ];
        }
        
        if (startDate && endDate) {
            matchStage.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const pipeline = [
            { $match: matchStage },
            {
                $lookup: {
                    from: 'users',
                    localField: 'mainAssignee',
                    foreignField: '_id',
                    as: 'mainAssigneeDetails'
                }
            },
            {
                $group: {
                    _id: '$mainAssignee',
                    employeeName: { $first: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] } },
                    totalTasks: { $sum: 1 },
                    completedTasks: {
                        $sum: { $cond: [{ $eq: ['$status', 'הושלם'] }, 1, 0] }
                    },
                    cancelledTasks: {
                        $sum: { $cond: [{ $eq: ['$status', 'בוטלה'] }, 1, 0] }
                    },
                    urgentTasks: {
                        $sum: { $cond: [{ $eq: ['$importance', 'מיידי'] }, 1, 0] }
                    },
                    drawerTasks: {
                        $sum: { $cond: [{ $eq: ['$importance', 'מגירה'] }, 1, 0] }
                    },
                    avgCompletionDays: {
                        $avg: {
                            $cond: [
                                { $eq: ['$status', 'הושלם'] },
                                {
                                    $divide: [
                                        { $subtract: ['$updatedAt', '$createdAt'] },
                                        1000 * 60 * 60 * 24
                                    ]
                                },
                                null
                            ]
                        }
                    }
                }
            },
            {
                $addFields: {
                    completionRate: {
                        $multiply: [
                            { $divide: ['$completedTasks', '$totalTasks'] },
                            100
                        ]
                    }
                }
            },
            { $sort: { completionRate: -1 } }
        ];

        const results = await Task.aggregate(pipeline);

        if (format === 'pdf') {
            return generatePDFReport(res, results, 'סטטיסטיקה אישית לעובדים');
        } else if (format === 'excel') {
            return generateExcelReport(res, results, 'סטטיסטיקה אישית לעובד');
        }

        res.json({
            success: true,
            data: results,
            generatedAt: new Date()
        });
}

// דוח משימות לפי עמותה
export const tasksByOrganization = async (req, res) => {
    const { organizationId, format = 'json' } = req.query;
    
    let matchStage = { isDeleted: { $ne: true } };
    if (organizationId) {
        matchStage.organization = organizationId;
    }

    const pipeline = [
        { $match: matchStage },
        {
            $lookup: {
                from: 'associations',
                localField: 'organization',
                foreignField: '_id',
                as: 'organizationDetails'
            }
        },
        {
            $group: {
                _id: '$organization',
                organizationName: { $first: { $arrayElemAt: ['$organizationDetails.name', 0] } },
                totalTasks: { $sum: 1 },

                // משימות שהושלמו
                completedTasks: {
                    $sum: { $cond: [{ $eq: ['$status', 'הושלם'] }, 1, 0] }
                },

                // משימות פעילות (לא הושלם ולא בוטלה)
                activeTasks: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $ne: ['$status', 'הושלם'] },
                                    { $ne: ['$status', 'בוטלה'] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },

                // משימות מיידיות
                urgentTasks: {
                    $sum: { $cond: [{ $eq: ['$importance', 'מיידי'] }, 1, 0] }
                },

                // משימות באיחור (עבר dueDate + לא הושלמה/בוטלה)
                overdueTasks: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $lt: ['$dueDate', new Date()] },
                                    { $ne: ['$status', 'הושלם'] },
                                    { $ne: ['$status', 'בוטלה'] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                }
            }
        },
        {
            $addFields: {
                completionRate: {
                    $cond: [
                        { $gt: ['$totalTasks', 0] },
                        { $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] },
                        0
                    ]
                }
            }
        },
        { $sort: { totalTasks: -1 } }
    ];

    const results = await Task.aggregate(pipeline);

    if (format === 'pdf') {
        return generatePDFReport(res, results, 'דוח משימות לפי עמותה');
    } else if (format === 'excel') {
        return generateExcelReport(res, results, 'דוח לעמותה');
    }

    res.json({
        success: true,
        data: results,
        generatedAt: new Date(),
        summary: {
            totalOrganizations: results.length,
            totalTasks: results.reduce((sum, org) => sum + org.totalTasks, 0),
            avgCompletionRate: results.length
                ? (results.reduce((sum, org) => sum + org.completionRate, 0) / results.length).toFixed(1)
                : 0
        }
    });
};

// פונקציות עזר להפקת קבצים
const generatePDFReport = (res, data, title) => {
    const doc = new PDFDocument();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title}.pdf"`);
    
    doc.pipe(res);
    
    // כותרת
    doc.fontSize(18).text(title, { align: 'center' });
    doc.fontSize(12).text(`נוצר בתאריך: ${moment().format('DD/MM/YYYY HH:mm')}`, { align: 'center' });
    doc.moveDown(2);
    
    // תוכן (פשוט לדוגמה - ניתן לשפר)
    data.forEach((item, index) => {
        doc.text(`${index + 1}. ${JSON.stringify(item, null, 2)}`);
        doc.moveDown();
    });
    
    doc.end();
};

const generateExcelReport = async (res, data, filename) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('דוח');
    
    if (data.length > 0) {
        // הגדרת כותרות
        const headers = Object.keys(data[0]);
        worksheet.addRow(headers);
        
        // הוספת הנתונים
        data.forEach(item => {
            const row = headers.map(header => item[header]);
            worksheet.addRow(row);
        });
    }
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    
    await workbook.xlsx.write(res);
};
