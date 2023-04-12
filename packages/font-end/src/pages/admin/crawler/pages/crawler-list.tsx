import { PageContainer, Statistic as ProStatistic } from "@ant-design/pro-components";
import React, { CSSProperties, useEffect, useMemo, useState } from "react";
import styled from "@emotion/styled";
import { LeftOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Radio, message } from "antd";
import { CardTabListType } from "antd/es/card";
import { COLOR } from "@/styles/colors";
import { ApiReq } from "common/request/crawler/crawler";
import { useRequest } from "ahooks";
import { crawlerResource, CrawlerInfo } from "../services/crawler.resource";
import { useNavigate, useParams } from "react-router-dom";
import { CrawlerProcessStatus, CrawlerStatus } from "common/request/enum";
import { CrawlerCard } from "../components/crawler-card";

const statusMap = {
    all: { title: "全部" },
    error: { status: "error" as const, title: "异常停止" },
    running: { status: "success" as const, title: "运行中" },
    stopped: { status: "default" as const, title: "未运行" },
};

export default function CrawlerList() {
    const pathParams = useParams();
    const navigate = useNavigate();
    let processId = pathParams.processId ? parseInt(pathParams.processId) : undefined;
    const [currentTab, setCurrentTab] = useState<keyof typeof group>("all");
    const [showCreateModal, setShowCreateModal] = useState(false);

    const {
        data: { crawlerList, processName, processStatus } = {
            crawlerList: [],
            processName: "",
            processStatus: CrawlerProcessStatus.stop,
        },
        loading,
        refresh,
    } = useRequest(
        async () => {
            if (!processId) return;
            return crawlerResource.getCrawlerList(processId);
        },
        { pollingInterval: 2000 }
    );
    const group = useMemo(() => {
        let group = {
            all: crawlerList,
            error: [] as CrawlerInfo[],
            running: [] as CrawlerInfo[],
            stopped: [] as CrawlerInfo[],
        };
        for (const crawler of crawlerList) {
            let type = crawler.status;
            if (type === CrawlerStatus.starting || type === CrawlerStatus.stopped) {
                if (crawler.reportAuth) group.error.push(crawler);
                else group.stopped.push(crawler);
            } else group.running.push(crawler);
        }
        return group;
    }, [crawlerList]);
    const tabs = useMemo(
        () =>
            Object.entries(group).map(([key, list], i): CardTabListType => {
                let props = {
                    ...statusMap[key as keyof typeof statusMap],
                    value: list.length,
                    layout: "horizontal" as const,
                };
                let style: CSSProperties = {
                    lineHeight: "30px",
                    width: 100,
                };
                if (i == 0)
                    Object.assign(style, {
                        borderInlineEnd: "1px solid #f0f0f0",
                        paddingRight: 12,
                    });

                return {
                    key,
                    tab: <CssStatistic {...props} style={style} />,
                };
            }),
        [group]
    );

    return (
        <PageContainer backIcon={<LeftOutlined />} title={processName} onBack={() => navigate(-1)}>
            <Card
                tabList={tabs}
                onTabChange={(key) => setCurrentTab(key as any)}
                bodyStyle={{}}
                headStyle={{ fontWeight: "bold", fontSize: "24px" }}
                title={"采集器进程: " + processName}
                extra={
                    <Button type="primary" onClick={() => setShowCreateModal(true)}>
                        添加crawler
                    </Button>
                }
            >
                <CrawlerCardList
                    data={group[currentTab]}
                    pcId={processId!}
                    pcStatus={processStatus}
                    onRefresh={refresh}
                />
            </Card>
            {processId !== undefined && (
                <CrawlerAddModal
                    open={showCreateModal}
                    onCancel={() => setShowCreateModal(false)}
                    pcId={processId}
                    onRefresh={refresh}
                />
            )}
        </PageContainer>
    );
}

interface ProcessAddModalProps {
    open?: boolean;
    onCancel: () => void;
    onRefresh: () => void;
    info?: { name: string; memoryLimit: number; id: number };
    pcId: number;
}
function CrawlerAddModal(props: ProcessAddModalProps) {
    const { info, open, pcId } = props;
    const typeDesc = info ? "修改" : "创建";
    const { loading, runAsync } = useRequest(
        async function (data: ApiReq.CreateCrawler) {
            if (!data.taskCountLimit) delete data.taskCountLimit;
            if (info) return crawlerResource.updateCrawler({ crawlerId: info.id, processId: pcId }, data);
            else return crawlerResource.createCrawler(pcId, data);
        },
        {
            manual: true,
            onSuccess() {
                message.success(typeDesc + "成功");
            },
            onError(e, params) {
                message.error(typeDesc + "失败");
            },
        }
    );
    const [form] = Form.useForm();

    async function onOk() {
        let formValues = form.getFieldsValue();
        await runAsync(formValues);
        props.onRefresh();
        props.onCancel();
    }
    useEffect(() => {
        if (open) {
            form.resetFields();
            if (info) form.setFieldsValue(info);
        }
    }, [form, info, open]);
    return (
        <Modal
            open={open}
            destroyOnClose
            title={typeDesc + "进程"}
            onCancel={props.onCancel}
            onOk={onOk}
            okText={typeDesc}
            confirmLoading={loading}
            bodyStyle={{ paddingTop: 24 }}
        >
            <Form form={form} layout="horizontal">
                <Form.Item label="Crawler名称" name="name">
                    <Input />
                </Form.Item>
                <Form.Item label="任务类型" name="taskType">
                    <Radio.Group defaultValue="all">
                        <Radio value="all">全部</Radio>
                        <Radio value="jobFilter">jobFilter</Radio>
                        <Radio value="company">company</Radio>
                    </Radio.Group>
                </Form.Item>
                {!info && (
                    <Form.Item label="任务上限" name="taskCountLimit">
                        <InputNumber min={1} />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    );
}
function CrawlerCardList(props: {
    data: CrawlerInfo[];
    pcId: number;
    onRefresh: () => void;
    pcStatus: CrawlerProcessStatus;
}) {
    const { data, pcId, pcStatus } = props;
    const [modal, modalNode] = Modal.useModal();
    function onDelete(id: number) {
        Modal.confirm({
            title: "确定删除该Crawler?",
            async onOk() {
                await crawlerResource.deleteCrawler({ processId: pcId, crawlerId: id });
                props.onRefresh();
            },
        });
    }
    async function onUpdateStart(id: number, start: boolean) {
        if (start && pcStatus !== CrawlerProcessStatus.running) {
            message.error("进程未启动, 无法启动Crawler");
            return;
        }
        try {
            await crawlerResource.updateCrawler({ processId: pcId, crawlerId: id }, { start });
            message.success("指令发送成功");
            props.onRefresh();
        } catch (error) {}
    }
    function onStop(id: number) {
        Modal.confirm({
            title: "确定终止该Crawler?",
            onOk: () => onUpdateStart(id, false),
        });
    }
    const cardList = useMemo(
        () =>
            data.map((item) => (
                <CrawlerCard
                    key={item.id}
                    {...item}
                    onDelete={onDelete}
                    onStart={(id) => onUpdateStart(id, true)}
                    onStop={onStop}
                />
            )),
        [data]
    );
    if (data.length)
        return (
            <>
                <flex style={{ background: COLOR.gray2, padding: "14px", gap: 12, flexWrap: "wrap" }}>{cardList}</flex>
                {modalNode}
            </>
        );
    else return <Empty />;
}

const CssStatistic = styled(ProStatistic)`
    .ant-statistic,
    .ant-pro-card-statistic-wrapper {
        align-items: center;
    }
`;
