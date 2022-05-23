const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile');
const { Op, fn, col, literal } = require('sequelize');
const { json } = require('body-parser');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params
    const userId = req.profile.id
    const contract = await Contract.findOne({
        where: {
            id,
            [Op.or]: [
                {
                    ClientId: userId
                },
                {
                    ContractorId: userId
                }
            ],
        }
    });

    if (!contract) return res.status(404).end()
    res.json(contract)
})

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const userId = req.profile.id
    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                {
                    ClientId: userId
                },
                {
                    ContractorId: userId
                }
            ],
            status: {
                [Op.not]: 'terminated'
            },
        }
    });

    if (!contracts) return res.status(404).end()
    res.json(contracts)
})

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job, Contract } = req.app.get('models')
    const userId = req.profile.id
    const jobs = await Job.findAll({
        include: {
            model: Contract,
            where: {
                [Op.or]: [
                    {
                        ClientId: userId
                    },
                    {
                        ContractorId: userId
                    }
                ],
                status: {
                    [Op.not]: 'terminated'
                },
            },
            required: true,
            attributes: [],
        },
        where: {
            paid: null,
        }
    });

    if (!jobs) return res.status(404).end()
    res.json(jobs)
})

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const userId = req.profile.id
    const { job_id } = req.params;
    const client = await Profile.findOne({ where: { id: userId, type: 'client' } });

    const job = await Job.findOne({
        include: {
            model: Contract,
            where: {
                ClientId: userId,
                status: {
                    [Op.not]: 'terminated'
                },
            },
            required: true,
        },
        where: {
            paid: null,
            id: job_id,
        }
    });

    const contractor = await Profile.findOne({ where: { id: job.Contract.ContractorId, type: 'contractor' } });

    if (!job || !client || !contractor) return res.status(404).end()
    if (client.balance < job.price) return res.status(403).end()

    job.paid = 1;
    job.paymentDate = new Date;
    job.Contract.status = 'terminated';
    client.balance -= job.price;
    contractor.balance += job.price;

    job.save();
    client.save();
    contractor.save();

    res.status(200).end()
})

app.post('/balances/deposit/:userId', json(), getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models')
    const { userId } = req.params;
    const { balance } = req.body;
    const client = await Profile.findOne({ where: { id: userId, type: 'client' } });

    const jobs = await Job.findAll({
        attributes: [
            [fn('sum', col('price')), 'total_price']
        ],
        include: {
            model: Contract,
            where: {
                ClientId: client.id,
                status: {
                    [Op.not]: 'terminated'
                },
            },
            required: true,
            attributes: [],
        },
        where: {
            paid: null,
        }
    });

    if (!client || !jobs) return res.status(404).end()
    if ((jobs[0].total_amount / 4) > balance) return res.status(403).end();

    client.balance += balance;

    client.save();

    res.status(200).end()
})

app.get('/admin/best-profession', getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models')
    const { start, end } = req.query;
    const mostPaidProfession = await Job.findOne({
        attributes: [
            [fn('sum', col('price')), 'total_earned']
        ],
        include: {
            model: Contract,
            required: true,
            include: {
                model: Profile,
                as: 'Contractor',
                required: true,
                attributes: ['profession'],
            }
        },
        where: {
            paid: 1,
            paymentDate: {
                [Op.between]: [new Date(start), new Date(end)],
            }
        },
        order: [[literal('total_earned'), 'DESC']],
        group: ['contract.Contractor.profession'],
    });

    if (!mostPaidProfession) return res.status(404).end()
    res.json({
        profession: mostPaidProfession.Contract.Contractor.profession,
    })
})

app.get('/admin/best-clients', getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models')
    const { start, end, limit } = req.query;

    const jobs = await Job.findAll({
        attributes: [
            [fn('sum', col('price')), 'paid']
        ],
        include: {
            model: Contract,
            required: true,
            include: {
                model: Profile,
                as: 'Client',
                required: true,
                attributes: [
                    'id',
                    [literal("firstName || ' ' || lastName"), "fullName"],
                ],
            }
        },
        where: {
            paid: 1,
            paymentDate: {
                [Op.between]: [new Date(start), new Date(end)],
            }
        },
        order: [['paid', 'DESC']],
        limit: limit || 2,
        group: ['contract.Client.id'],
    });

    if (!jobs) return res.status(404).end()
    
    const bestPayingClients = [];

    for (const job of jobs) {
        const bestPayingClient = {
            id: job.Contract.Client.id,
            fullName: job.Contract.Client.get('fullName'),
            paid: job.paid,
        }
        bestPayingClients.push(bestPayingClient);
    }

    res.json(bestPayingClients);
})

module.exports = app;
